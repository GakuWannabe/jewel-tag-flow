// HUID string helpers only. Weight matching runs server-side (suggest_huids RPC) so staff never see piece weights.
const CONFUSABLE = /[0O1I5S8B2Z]/;
export const hasConfusable = (h: string) => CONFUSABLE.test(h);
export const normHuid = (h: string) => h.trim().toUpperCase();
export const validHuid = (h: string) => /^[A-Z0-9]{6}$/.test(h);
