const express = require('express');

const supabase = require('../lib/supabase');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { nextStatus } = require('../lib/constants');

const router = express.Router();

router.use(authMiddleware, adminMiddleware);

// GET /admin/orders?status=preparing — liste pour l'écran de gestion cuisine
router.get('/orders', async (req, res) => {
  try {
    let query = supabase.from('orders').select('*, users(first_name, username)').order('created_at', { ascending: true });
    if (req.query.status) query = query.eq('status', req.query.status);

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

module.exports = router;
