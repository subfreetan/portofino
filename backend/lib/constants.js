// Règles métier Portofino — à garder synchronisées avec le front (codées en dur des deux côtés).

const POINTS_PER_EUR = 4;

const REWARDS = {
  boisson: { label: 'Boisson', cost: 100 },
  pizza:   { label: 'Pizza',   cost: 300 },
  pates:   { label: 'Pâtes',   cost: 350 },
};

const ORDER_STATUSES = ['pending', 'confirmed', 'preparing', 'ready', 'collected'];

function nextStatus(current) {
  const i = ORDER_STATUSES.indexOf(current);
  if (i === -1 || i === ORDER_STATUSES.length - 1) return null;
  return ORDER_STATUSES[i + 1];
}

function generatePickupCode() {
  // Code court à 5 chiffres, donné au comptoir (pas besoin d'unicité stricte, juste lisible à l'oral)
  return String(Math.floor(10000 + Math.random() * 90000));
}

function generateCardNumber() {
  // Identifiant encodé dans le QR de l'écran "account"
  return 'PF' + String(Math.floor(1e11 + Math.random() * 9e11));
}

module.exports = {
  POINTS_PER_EUR,
  REWARDS,
  ORDER_STATUSES,
  nextStatus,
  generatePickupCode,
  generateCardNumber,
};
