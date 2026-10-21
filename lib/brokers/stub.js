// The stub broker: what Bot X-Ray ships with. It shows the shape every adapter has (see TEMPLATE.md) and
// refuses to place orders, because no real broker is wired in yet. Paper trading doesn't use it at all.
export default {
  name: "stub",
  title: "No broker connected",
  live: false,
  venues: [],
  note: 'No broker is connected, so Bot X-Ray trades on paper only. To connect yours, ask Claude: "connect Bot X-Ray to my <broker> account". It writes lib/brokers/<name>.js from lib/brokers/TEMPLATE.md, and you put your keys in the .env file in this folder.',

  // Which account the keys belong to: { ok, mode: "paper" | "live", cash }.
  async account(keys) {
    return {
      ok: false,
      mode: null,
      cash: null,
      note: keys?.keyId
        ? "Keys found, but no broker adapter is connected to use them."
        : "No keys found.",
    };
  },

  // Place one limit order: { venue, ticker, side: "yes" | "no", contracts, limit }. Returns { id, status }.
  async submit() {
    throw new Error(this.note);
  },

  // Open positions at the broker.
  async positions() {
    return [];
  },
};
