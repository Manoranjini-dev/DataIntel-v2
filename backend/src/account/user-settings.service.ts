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
      `SELECT theme, notification_prefs
       FROM user_settings
       WHERE account_id = $1`,
      [accountId]
    );

    if (!settings) {
      // Return defaults if not set
      return {
        theme: 'system',
        notification_preferences: { email: true, in_app: true },
      };
    }

    return settings;
  }

  /**
   * Update settings for a user
   */
  async updateSettings(accountId: string, data: { theme?: string; notificationPreferences?: any }) {
    return this.db.queryOne(
      `INSERT INTO user_settings (account_id, theme, notification_prefs)
       VALUES ($1, COALESCE($2, 'system'), COALESCE($3, '{"email": true, "in_app": true}'::jsonb))
       ON CONFLICT (account_id) DO UPDATE SET
         theme = COALESCE(EXCLUDED.theme, user_settings.theme),
         notification_prefs = COALESCE(EXCLUDED.notification_prefs, user_settings.notification_prefs),
         updated_at = NOW()
       RETURNING *`,
      [accountId, data.theme || null, data.notificationPreferences ? JSON.stringify(data.notificationPreferences) : null]
    );
  }
}
