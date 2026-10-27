import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);

// Dominios con acceso (debe coincidir con public.es_usuario_autorizado()).
export const DOMINIOS = ['terra-mare.com.ar'];
