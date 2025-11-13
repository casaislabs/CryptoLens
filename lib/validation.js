import { z } from 'zod';

if (typeof window !== 'undefined') {
  throw new Error('Do not import `lib/validation.js` in the browser. Use server/API only.');
}

// Generic token id used by CoinGecko and our DB
export const TokenId = z.string().min(1).max(100).regex(/^[a-z0-9-]+$/);

// updateFavorites body
export const UpdateFavoritesBody = z.object({
  favorites: z.array(TokenId).max(200, { message: 'Too many favorites (max 200)' })
});

// wallet body
export const WalletAction = z.enum(['check','link','unlink','getProfile','challenge']);
export const WalletMethod = z.enum(['siwe','personal_sign','session']);
export const WalletBody = z.object({
  action: WalletAction,
  method: WalletMethod.optional(),
  // For legacy compatibility: not used for linking anymore
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/,{ message: 'Invalid Ethereum address format' }).optional(),
  // Signature fields
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/,{ message: 'Invalid signature hex' }).optional(),
  siweMessage: z.string().max(4000).optional(),
}).superRefine((val, ctx) => {
  if (val.action === 'challenge') {
    if (!val.method) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'method is required for action=challenge', path: ['method']});
    }
    // For challenge, only siwe or personal_sign are valid methods
    if (val.method && !['siwe','personal_sign'].includes(val.method)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid method for challenge', path: ['method']});
    }
  }
  if (val.action === 'link') {
    if (!val.method) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'method is required for action=link', path: ['method']});
    } else if (val.method === 'personal_sign') {
      if (!val.signature) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'signature is required for personal_sign', path: ['signature']});
      }
    } else if (val.method === 'siwe') {
      if (!val.signature) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'signature is required for siwe', path: ['signature']});
      }
      if (!val.siweMessage) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'siweMessage is required for siwe', path: ['siweMessage']});
      }
    }
    // method 'session' requires no signature and is allowed
  }
});

// fetchTokens query
export const FetchTokensQuery = z.object({
  ids: z.string().min(1)
});

// top tokens query
export const TopTokensQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional()
});

// Helper to parse safely
export function parseOrThrow(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ path: i.path, message: i.message }));
    const err = new Error('Validation error');
    err.name = 'ValidationError';
    err.details = details;
    throw err;
  }
  return result.data;
}