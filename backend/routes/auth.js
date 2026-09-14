const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const QRCode = require('qrcode');

const supabase = require('../lib/supabase');
const { authMiddleware } = require('../middleware/auth');
const { generateCardNumber } = require('../lib/constants');

const router = express.Router();

function signToken(userId) {
  return jwt.sign({ sub: userId }, process.env.JWT_SECRET, { expiresIn: '90d' });
}

// POST /auth/register  { firstName, username, password }
router.post('/register', async (req, res) => {
  try {
    const { firstName, username, password } = req.body;
    if (!firstName || !username || !password) {
      return res.status(400).json({ error: 'Prénom, pseudo et mot de passe requis.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Le mot de passe doit faire au moins 6 caractères.' });
    }

    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('username', username)
      .maybeSingle();

    if (existing) return res.status(409).json({ error: 'Ce pseudo est déjà pris.' });

    const passwordHash = await bcrypt.hash(password, 10);

    let cardNumber = generateCardNumber();
    // évite (rare) collision
    for (let i = 0; i < 3; i++) {
      const { data: clash } = await supabase.from('users').select('id').eq('card_number', cardNumber).maybeSingle();
      if (!clash) break;
      cardNumber = generateCardNumber();
    }

    const { data: user, error } = await supabase
      .from('users')
      .insert({ first_name: firstName, username, password_hash: passwordHash, card_number: cardNumber })
      .select('id, first_name, username, card_number, points_balance, lifetime_points, points_spent, role')
      .single();

    if (error) throw error;

    const token = signToken(user.id);
    res.status(201).json({ token, user });
  } catch (err) {
    console.error('register error:', err);
    res.status(500).json({ error: 'Erreur lors de l\'inscription.' });
  }
});

// POST /auth/login  { username, password }
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Pseudo et mot de passe requis.' });
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('id, first_name, username, password_hash, card_number, points_balance, lifetime_points, points_spent, role')
      .eq('username', username)
      .single();

    if (error || !user) return res.status(401).json({ error: 'Identifiants incorrects.' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Identifiants incorrects.' });

    delete user.password_hash;
    const token = signToken(user.id);
    res.json({ token, user });
  } catch (err) {
    console.error('login error:', err);
    res.status(500).json({ error: 'Erreur lors de la connexion.' });
  }
});

// GET /auth/profile
router.get('/profile', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

// GET /auth/qrcode — QR encodant le card_number, pour l'écran "account"
router.get('/qrcode', authMiddleware, async (req, res) => {
  try {
    const dataUrl = await QRCode.toDataURL(req.user.card_number, { margin: 1, width: 400 });
    res.json({ qrCode: dataUrl, cardNumber: req.user.card_number });
  } catch (err) {
    console.error('qrcode error:', err);
    res.status(500).json({ error: 'Erreur lors de la génération du QR code.' });
  }
});

module.exports = router;
