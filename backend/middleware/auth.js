const jwt = require('jsonwebtoken');
const supabase = require('../lib/supabase');

async function authMiddleware(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Token manquant.' });

    const payload = jwt.verify(token, process.env.JWT_SECRET);

    const { data: user, error } = await supabase
      .from('users')
      .select('id, first_name, username, card_number, points_balance, lifetime_points, points_spent, role')
      .eq('id', payload.sub)
      .single();

    if (error || !user) return res.status(401).json({ error: 'Utilisateur introuvable.' });

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalide ou expiré.' });
  }
}

function adminMiddleware(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Accès réservé aux administrateurs.' });
  }
  next();
}

module.exports = { authMiddleware, adminMiddleware };
