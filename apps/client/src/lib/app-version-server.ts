import { createServerFn } from '@tanstack/react-start'
import { getClientVersionId } from '@/env'

export const getClientVersionIdServerFn = createServerFn({
  method: 'GET',
}).handler(() => getClientVersionId())
