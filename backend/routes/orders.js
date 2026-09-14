const express = require('express');
const Stripe = require('stripe');

const supabase = require('../lib/supabase');
const { authMiddleware } = require('../middleware/auth');
const { POINTS_PER_EUR, REWARDS, generatePickupCode } = require('../lib/constants');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const router = express.Router();

// POST /orders
// Body normal   : { items: [{name, detail, qty, unitPrice}], paymentMethod: 'card' }
// Body récompense : { items: [...], paymentMethod: 'reward', rewardType: 'boisson'|'pizza'|'pates' }
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { items, paymentMethod, rewardType } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'La commande doit contenir au moins un article.' });
    }
    if (!['card', 'reward'].includes(paymentMethod)) {
      return res.status(400).json({ error: 'Moyen de paiement invalide.' });
    }

    const pickupCode = generatePickupCode();

    // ---------- Commande payée avec des points ----------
    if (paymentMethod === 'reward') {
      const reward = REWARDS[rewardType];
      if (!reward) return res.status(400).json({ error: 'Récompense invalide.' });
      if (req.user.points_balance < reward.cost) {
        return res.status(400).json({ error: 'Points insuffisants pour cette récompense.' });
      }

      const { data: order, error: orderErr } = await supabase
        .from('orders')
        .insert({
          user_id: req.user.id,
          items,
          total: 0,
          status: 'confirmed', // pas de paiement à attendre, on passe direct en préparation
          payment_method: 'reward',
          pickup_code: pickupCode,
          is_reward: true,
          reward_type: rewardType,
        })
        .select()
        .single();

      if (orderErr) throw orderErr;

      const { error: userErr } = await supabase
        .from('users')
        .update({
          points_balance: req.user.points_balance - reward.cost,
          points_spent: req.user.points_spent + reward.cost,
        })
        .eq('id', req.user.id);

      if (userErr) throw userErr;

      return res.status(201).json({ order });
    }

    // ---------- Commande payée par carte (Stripe) ----------
    const total = items.reduce((sum, it) => sum + it.unitPrice * it.qty, 0);

    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .insert({
        user_id: req.user.id,
        items,
        total,
        status: 'pending',
        payment_method: 'card',
        pickup_code: pickupCode,
      })
      .select()
      .single();

    if (orderErr) throw orderErr;

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(total * 100),
      currency: 'eur',
      description: items.map((it) => it.detail || it.name).join(', '),
      metadata: { order_id: order.id, user_id: req.user.id },
    });

    await supabase
      .from('orders')
      .update({ stripe_payment_intent: paymentIntent.id })
      .eq('id', order.id);

    res.status(201).json({ order, clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error('create order error:', err);
    res.status(500).json({ error: 'Erreur lors de la création de la commande.' });
  }
});

// GET /orders — historique de l'utilisateur
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { data: orders, error } = await supabase
      .from('orders')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ orders });
  } catch (err) {
    console.error('list orders error:', err);
    res.status(500).json({ error: 'Erreur lors de la récupération des commandes.' });
  }
});

// GET /orders/:id — suivi (polling par l'écran "track")
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { data: order, error } = await supabase
      .from('orders')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();

    if (error || !order) return res.status(404).json({ error: 'Commande introuvable.' });
    res.json({ order });
  } catch (err) {
    console.error('get order error:', err);
    res.status(500).json({ error: 'Erreur lors de la récupération de la commande.' });
  }
});

// POST /orders/stripe-webhook — doit être monté AVANT express.json() dans server.js (voir server.js)
async function stripeWebhookHandler(req, res) {
  let event;
  try {
    const signature = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(req.body, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Signature webhook invalide:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'payment_intent.succeeded') {
    const intent = event.data.object;
    const orderId = intent.metadata.order_id;
    const userId = intent.metadata.user_id;

    const { data: order } = await supabase.from('orders').select('*').eq('id', orderId).single();
    if (order && order.status === 'pending') {
      const pointsEarned = Math.floor(order.total * POINTS_PER_EUR);

      await supabase
        .from('orders')
        .update({ status: 'confirmed', points_earned: pointsEarned })
        .eq('id', orderId);

      const { data: user } = await supabase.from('users').select('points_balance, lifetime_points').eq('id', userId).single();
      if (user) {
        await supabase
          .from('users')
          .update({
            points_balance: user.points_balance + pointsEarned,
            lifetime_points: user.lifetime_points + pointsEarned,
          })
          .eq('id', userId);
      }
    }
  }

  res.json({ received: true });
}

module.exports = { router, stripeWebhookHandler };
