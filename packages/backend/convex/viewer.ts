import { ConvexError, v } from 'convex/values'
import { query } from './_generated/server'

export const current = query({
  args: {},
  returns: v.object({
    subject: v.string(),
    name: v.string(),
    email: v.optional(v.string()),
  }),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()

    if (identity === null) {
      throw new ConvexError('Authentication required')
    }

    return {
      subject: identity.subject,
      name: identity.name ?? identity.email ?? identity.subject,
      email: identity.email,
    }
  },
})
