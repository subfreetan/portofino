require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const { router: ordersRoutes, stripeWebhookHandler } = require('./routes/orders');
const adminRoutes = require('./routes/admin');

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));

// Le webhook Stripe a besoin du corps brut (raw) pour vérifier la signature :
// il doit être monté AVANT express.json().
app.post('/orders/stripe-webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler);

app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true, service: 'portofino-backend' }));

app.use('/auth', authRoutes);
app.use('/orders', ordersRoutes);
app.use('/admin', adminRoutes);

app.use((req, res) => res.status(404).json({ error: 'Route introuvable.' }));

app.use((err, req, res, next) => {
  console.error('Erreur non gérée:', err);
  res.status(500).json({ error: 'Erreur serveur.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Portofino backend démarré sur le port ${PORT}`));
