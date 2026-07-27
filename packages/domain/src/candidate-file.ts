import { Schema } from 'effect'

/**
 * A repository-relative file path that is safe to expose in candidate evidence.
 *
 * This intentionally models files, not directories: trailing separators,
 * absolute paths, traversal segments, control characters, and empty segments
 * are rejected at the untrusted diff boundary.
 */
export const CandidateFilePath = Schema.String.check(
  Schema.makeFilter(
    (path) =>
      path.length > 0 &&
      !path.startsWith('/') &&
      !path.endsWith('/') &&
      !path.includes('\0') &&
      !path.includes('\n') &&
      !path.includes('\r') &&
      path
        .split('/')
        .every(
          (segment) =>
            segment.length > 0 && segment !== '.' && segment !== '..',
        ),
    { expected: 'a safe repository-relative candidate file path' },
  ),
).pipe(Schema.brand('CandidateFilePath'))

export type CandidateFilePath = Schema.Schema.Type<typeof CandidateFilePath>

export const makeCandidateFilePath = Schema.decodeUnknownSync(CandidateFilePath)
