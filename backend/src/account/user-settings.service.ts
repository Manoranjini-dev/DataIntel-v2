// ──────────────────────────────────────────────
// User Settings Service — Managing individual user preferences
// ──────────────────────────────────────────────

import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class UserSettingsService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Get settings for a user
   */
  async getSettings(accountId: string) {
    const settings = await this.db.queryOne(
      `SELECT theme, default_org_id, notification_preferences
       FROM user_settings
       WHERE account_id = $1`,
      [accountId]
    );

    if (!settings) {
      // Return defaults if not set
      return {
        theme: 'system',
        default_org_id: null,
        notification_preferences: { email: true, in_app: true },
      };
    }

    return settings;
  }

  /**
   * Update settings for a user
   */
  async updateSettings(accountId: string, data: { theme?: string; defaultOrgId?: string; notificationPreferences?: any }) {
    return this.db.queryOne(
      `INSERT INTO user_settings (account_id, theme, default_org_id, notification_preferences)
       VALUES ($1, COALESCE($2, 'system'), $3, COALESCE($4, '{"email": true, "in_app": true}'::jsonb))
       ON CONFLICT (account_id) DO UPDATE SET
         theme = COALESCE(EXCLUDED.theme, user_settings.theme),
         default_org_id = EXCLUDED.default_org_id,
         notification_preferences = COALESCE(EXCLUDED.notification_preferences, user_settings.notification_preferences),
         updated_at = NOW()
       RETURNING *`,
      [accountId, data.theme || null, data.defaultOrgId || null, data.notificationPreferences ? JSON.stringify(data.notificationPreferences) : null]
    );
  }
}
