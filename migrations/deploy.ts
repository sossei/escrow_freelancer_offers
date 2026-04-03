// Migrations are an early feature. Currently, they're depleted and not meant
// to be used in production. They could eventually be used, for instance, to
// provide for automated upgrades.

const anchor = require("@coral-xyz/anchor");

module.exports = async function (provider: any) {
  anchor.setProvider(provider);
};
