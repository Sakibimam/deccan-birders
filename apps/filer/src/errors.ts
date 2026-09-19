/**
 * Upload failures carry a distinguishing reason all the way to the screen.
 *
 * "Something went wrong" is how the group lost three years of records without
 * noticing: the app said it saved, or said nothing useful, and nobody could
 * tell a missing stamp from a dropped network. Every failure below renders as
 * its own sentence with its own suggested action.
 */
export type UploadFailureKind =
  | 'not-signed-in'
  | 'no-stamp'
  | 'stamp-expired'
  | 'stamper-failed'
  | 'gateway-refused'
  | 'network'
  | 'photo-too-large'
  | 'invalid-record'
  | 'feed-write-failed'
  | 'unknown'

export class UploadFailure extends Error {
  readonly kind: UploadFailureKind
  /** What the person should actually do about it. */
  readonly remedy: string
  readonly detail?: string

  constructor(kind: UploadFailureKind, message: string, remedy: string, detail?: string) {
    super(message)
    this.name = 'UploadFailure'
    this.kind = kind
    this.remedy = remedy
    this.detail = detail
  }
}

/** Maps Swarm ID's `uploadUnavailableReason` onto a specific, actionable message. */
export function describeUnavailable(reason: string | undefined, signedIn: boolean): UploadFailure {
  if (!signedIn) {
    return new UploadFailure(
      'not-signed-in',
      'You are not signed in.',
      'Sign in with Swarm ID to file a sighting. Your records are stored under your own identity.',
    )
  }
  switch (reason) {
    case 'no-stamp':
      return new UploadFailure(
        'no-stamp',
        'Your account has no storage of its own yet.',
        'This app normally covers storage for you through a shared gateway. If you are seeing this, the gateway is unreachable — your sighting is kept in the form, so try again shortly.',
        'uploadUnavailableReason: no-stamp',
      )
    case 'stamp-expired':
      return new UploadFailure(
        'stamp-expired',
        'Your storage has expired.',
        'Swarm storage is prepaid and yours has run out. Top up your Swarm ID storage, or sign out and back in to use the shared gateway.',
        'uploadUnavailableReason: stamp-expired',
      )
    case 'stamper-failed':
      return new UploadFailure(
        'stamper-failed',
        'Storage was found but could not be used to sign this upload.',
        'This is usually temporary. Try again; if it persists, sign out and back in.',
        'uploadUnavailableReason: stamper-failed',
      )
    default:
      return new UploadFailure(
        'unknown',
        'Uploads are not available right now.',
        'Check your connection and try again.',
        `uploadUnavailableReason: ${reason ?? 'undefined'}`,
      )
  }
}

/** Distinguishes the bare "Failed to fetch" the gateway produces on a refused header. */
export function classifyThrown(error: unknown): UploadFailure {
  const message = error instanceof Error ? error.message : String(error)
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return new UploadFailure(
      'gateway-refused',
      'The storage gateway refused the request.',
      'The public gateway accepts only a narrow set of headers. If this keeps happening the gateway may be down — your sighting is still in the form.',
      message,
    )
  }
  if (/timeout|aborted/i.test(message)) {
    return new UploadFailure('network', 'The upload timed out.', 'Check your connection and try again.', message)
  }
  return new UploadFailure('unknown', 'The sighting could not be saved.', 'Try again. The details below may help.', message)
}
