declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    /** Comma-separated platform user ids allowed as owner. Unset = any authenticated platform user (previous behaviour). */
    OWNER_USER_IDS?: string;
  }
}
