const express = require('express');

const supabase = require('../lib/supabase');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { nextStatus, POINTS_PER_EUR, generatePickupCode } = require('../lib/constants');

const router = express.Router();

router.use(authMiddleware, adminMiddleware);

// GET /admin/orders?status=preparing&since=2026-09-15 — liste pour l'écran de gestion cuisine
router.get('/orders', async (req, res) => {
  try {
    let query = supabase.from('orders').select('*, users(first_name, username, card_number)').order('created_at', { ascending: false });
    if (req.query.status) query = query.eq('status', req.query.status);
    if (req.query.since) query = query.gte('created_at', req.query.since);

    const { data: orders, error } = await query;
    if (error) throw error;
    res.json({ orders });
  } catch (err) {
    console.error('admin list orders error:', err);
    res.status(500).json({ error: 'Erreur lors de la récupération des commandes.' });
  }
});

// PATCH /admin/orders/:id/advance — fait avancer le statut d'un cran
router.patch('/orders/:id/advance', async (req, res) => {
  try {
    const { data: order, error } = await supabase.from('orders').select('*').eq('id', req.params.id).single();
    if (error || !order) return res.status(404).json({ error: 'Commande introuvable.' });

    const next = nextStatus(order.status);
    if (!next) return res.status(400).json({ error: 'Cette commande est déjà à son statut final.' });

    const { data: updated, error: updErr } = await supabase
      .from('orders')
      .update({ status: next })
      .eq('id', req.params.id)
      .select()
      .single();

    if (updErr) throw updErr;
    res.json({ order: updated });
  } catch (err) {
    console.error('advance order error:', err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du statut.' });
  }
});

// POST /admin/scan  { code }  — écran "Scanner" de l'app
// Cherche d'abord un pickup_code (commande prête à remettre), sinon un card_number (fiche client au comptoir)
router.post('/scan', async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Code manquant.' });

    const { data: order } = await supabase
      .from('orders')
      .select('*, users(first_name, username, points_balance)')
      .eq('pickup_code', code)
      .neq('status', 'collected')
      .maybeSingle();

    if (order) {
      if (order.status !== 'ready') {
        return res.status(400).json({ error: `Commande pas encore prête (statut actuel : ${order.status}).` });
      }
      const { data: updated, error: updErr } = await supabase
        .from('orders')
        .update({ status: 'collected' })
        .eq('id', order.id)
        .select()
        .single();
      if (updErr) throw updErr;
      return res.json({ type: 'order', order: updated });
    }

    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('id, first_name, username, points_balance, lifetime_points, points_spent')
      .eq('card_number', code)
      .maybeSingle();

    if (userErr) throw userErr;
    if (!user) return res.status(404).json({ error: 'Code inconnu (ni commande, ni carte client).' });

    res.json({ type: 'user', user });
  } catch (err) {
    console.error('scan error:', err);
    res.status(500).json({ error: 'Erreur lors du scan.' });
  }
});

// POST /admin/orders/instore  { userId, items: [{name, detail, qty, unitPrice}], paymentMethod }
// Commande prise en direct par le staff pour un client scanné au comptoir.
// Toujours réglée sur place (carte du commerce ou espèces) : jamais de Stripe ici.
router.post('/orders/instore', async (req, res) => {
  try {
    const { userId, items, paymentMethod } = req.body;
    if (!userId) return res.status(400).json({ error: 'Client manquant.' });
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'La commande doit contenir au moins un article.' });
    }

    const { data: user, error: userErr } = await supabase.from('users').select('*').eq('id', userId).single();
    if (userErr || !user) return res.status(404).json({ error: 'Client introuvable.' });

    const total = items.reduce((sum, it) => sum + it.unitPrice * it.qty, 0);
    const pointsEarned = Math.floor(total * POINTS_PER_EUR);
    const pickupCode = generatePickupCode();

    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .insert({
        user_id: userId,
        items,
        total,
        status: 'preparing', // prise en charge immédiate, le client est au comptoir
        payment_method: paymentMethod === 'card' ? 'card' : 'counter',
        pickup_code: pickupCode,
        points_earned: pointsEarned,
      })
      .select()
      .single();
    if (orderErr) throw orderErr;

    const { data: updatedUser, error: updErr } = await supabase
      .from('users')
      .update({
        points_balance: user.points_balance + pointsEarned,
        lifetime_points: user.lifetime_points + pointsEarned,
      })
      .eq('id', userId)
      .select('points_balance')
      .single();
    if (updErr) throw updErr;

    res.status(201).json({ order, pointsEarned, newBalance: updatedUser.points_balance });
  } catch (err) {
    console.error('instore order error:', err);
    res.status(500).json({ error: 'Erreur lors de la création de la commande.' });
  }
});

// POST /admin/users/:id/points  { delta }  — ajustement manuel (correction, geste commercial…)
router.post('/users/:id/points', async (req, res) => {
  try {
    const delta = Number(req.body.delta);
    if (!Number.isFinite(delta) || delta === 0) {
      return res.status(400).json({ error: 'delta doit être un nombre non nul.' });
    }

    const { data: user, error: userErr } = await supabase.from('users').select('*').eq('id', req.params.id).single();
    if (userErr || !user) return res.status(404).json({ error: 'Client introuvable.' });

    const newBalance = Math.max(0, user.points_balance + delta);
    const update = { points_balance: newBalance };
    if (delta > 0) update.lifetime_points = user.lifetime_points + delta;

    const { data: updated, error: updErr } = await supabase
      .from('users')
      .update(update)
      .eq('id', req.params.id)
      .select('id, first_name, username, card_number, points_balance, lifetime_points, points_spent')
      .single();
    if (updErr) throw updErr;

    res.json({ user: updated });
  } catch (err) {
    console.error('manual points adjust error:', err);
    res.status(500).json({ error: 'Erreur lors de l\'ajustement des points.' });
  }
});

module.exports = router;
