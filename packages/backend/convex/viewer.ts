import { query } from './_generated/server'
import { v } from 'convex/values'

export const current = query({
  args: {},
  returns: v.object({
    subject: v.string(),
    name: v.string(),
    email: v.optional(v.string()),
  }),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()

    if (!identity) {
      throw new Error('Unauthorized')
    }

    return {
      subject: identity.subject,
      name: identity.name ?? identity.email ?? identity.subject,
      email: identity.email ?? undefined,
    }
  },
})
