# Portofino — Backend

Structure identique au backend café (Express + Supabase + Stripe + JWT), adaptée aux règles Portofino.

## Différences par rapport au backend café

- **Supprimé** : `eur_balance`, `free_coffee`, `card_visual`, la route `pay-with-wallet` et toute la logique de recharge de solde. Il n'y a pas de wallet chez Portofino.
- **`card_number`** : conservé, mais recentré sur son seul rôle d'identifiant encodé dans le QR de l'écran "account" (plus de lien avec un wallet).
- **`events` / `notifications`** : pas de tables, pas de routes. Décision prise le 14/09/2026 : les offres de l'accueil restent codées en dur côté front.
- **Description Stripe** : construite à partir de `item.detail` (texte libre décrivant la pizza/pâte composée), plus de `size`/`milk` comme dans le café.
- **Nouveaux champs** ajoutés dès `setup.sql` (pas de dette technique à rattraper comme sur le café) : `lifetime_points`, `points_spent` sur `users`, `pickup_code` sur `orders`.
- **Récompenses** : Boisson 100 pts / Pizza 300 pts / Pâtes 350 pts, codées en dur dans `lib/constants.js` (à garder synchronisées avec le front). Une récompense génère une commande à statut `confirmed` directement (pas de paiement), à récupérer au comptoir avec le `pickup_code`.
- **Statuts de commande** : `pending → confirmed → preparing → ready → collected`, avancés uniquement par l'admin via `PATCH /admin/orders/:id/advance`.
- **Scan comptoir** (`POST /admin/scan`) : accepte soit un `pickup_code` (marque la commande `collected` si elle est `ready`), soit un `card_number` (retourne la fiche points du client).

## Variables d'environnement

Voir `.env.example` : `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `JWT_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `FRONTEND_URL`, `PORT`.

## Installation

```bash
npm install
cp .env.example .env   # puis remplir les valeurs
npm run dev
```

Exécuter `setup.sql` dans l'éditeur SQL du nouveau projet Supabase Portofino avant de démarrer.
