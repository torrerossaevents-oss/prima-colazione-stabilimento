declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    /** Comma-separated platform user ids allowed as owner. Unset = any authenticated platform user (previous behaviour). */
    OWNER_USER_IDS?: string;
    /** "sites" (default) or "cloudflare-access" (see lib/server/auth.ts). */
    AUTH_MODE?: string;
    /** Cloudflare Access team domain, e.g. nome-team.cloudflareaccess.com */
    ACCESS_TEAM_DOMAIN?: string;
    /** Audience (AUD) tag of the Access application protecting this Worker. */
    ACCESS_AUD?: string;
  }
}
