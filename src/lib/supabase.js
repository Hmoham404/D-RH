import { createClient } from '@supabase/supabase-js';

function normalizeSupabaseUrl(value) {
  const raw = (value || '').trim();
  if (!raw) return '';

  return raw.replace(/\/rest\/v1\/?$/i, '');
}

const supabaseUrl = normalizeSupabaseUrl(import.meta.env.VITE_SUPABASE_URL);
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const isSecretKey = typeof supabaseAnonKey === 'string' && supabaseAnonKey.startsWith('sb_secret_');

export const hasSupabaseEnv = Boolean(supabaseUrl && supabaseAnonKey) && !isSecretKey;
export const supabaseHost = (() => {
  try {
    return supabaseUrl ? new URL(supabaseUrl).host : '';
  } catch {
    return '';
  }
})();

export const supabase = hasSupabaseEnv
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

export function getSupabaseConfigIssue() {
  if (!supabaseUrl || !supabaseAnonKey) {
    return 'Configuration Supabase incomplete. Remplis VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY.';
  }

  if (isSecretKey) {
    return 'Cle invalide pour le front: VITE_SUPABASE_ANON_KEY ne doit pas utiliser une cle sb_secret_. Utilise la cle anon ou publishable du projet.';
  }

  return '';
}

export function formatSupabaseError(error, contextLabel = 'Supabase') {
  const message = error?.message || String(error || '');

  if (message.includes('Failed to fetch')) {
    return `${contextLabel} indisponible: connexion impossible vers ${supabaseHost || 'votre projet Supabase'}. Verifie 1) VITE_SUPABASE_URL, 2) VITE_SUPABASE_ANON_KEY, 3) que tu as relance \`npm run dev\` apres modification du .env, 4) que le SQL a ete execute dans le meme projet Supabase.`;
  }

  return `${contextLabel} indisponible: ${message}`;
}
