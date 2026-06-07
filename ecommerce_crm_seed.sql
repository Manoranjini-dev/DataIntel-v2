-- ══════════════════════════════════════════════════════════════
-- E-Commerce CRM & Marketing Database — Schema + Seed Data
-- ══════════════════════════════════════════════════════════════

DROP DATABASE IF EXISTS ecommerce_crm;
CREATE DATABASE ecommerce_crm CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE ecommerce_crm;

-- ── Schema ─────────────────────────────────────────────────

CREATE TABLE leads (
  id INT AUTO_INCREMENT PRIMARY KEY,
  first_name VARCHAR(50) NOT NULL,
  last_name VARCHAR(50) NOT NULL,
  email VARCHAR(120) NOT NULL UNIQUE,
  source VARCHAR(50),
  status ENUM('new', 'contacted', 'qualified', 'converted', 'lost') DEFAULT 'new',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE campaigns (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  type ENUM('email', 'social', 'ads', 'affiliate') NOT NULL,
  status ENUM('draft', 'active', 'completed', 'paused') DEFAULT 'draft',
  budget DECIMAL(10,2),
  start_date DATE,
  end_date DATE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE email_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  campaign_id INT,
  lead_id INT,
  subject VARCHAR(200) NOT NULL,
  status ENUM('sent', 'opened', 'clicked', 'bounced') DEFAULT 'sent',
  sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE support_tickets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  lead_id INT,
  subject VARCHAR(150) NOT NULL,
  description TEXT,
  status ENUM('open', 'in_progress', 'resolved', 'closed') DEFAULT 'open',
  priority ENUM('low', 'medium', 'high', 'urgent') DEFAULT 'medium',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ── Seed Data ──────────────────────────────────────────────

INSERT INTO leads (first_name, last_name, email, source, status) VALUES
('Alice', 'Johnson', 'alice.johnson@example.com', 'Organic Search', 'qualified'),
('Bob', 'Smith', 'bob.smith@example.com', 'Facebook Ads', 'contacted'),
('Charlie', 'Brown', 'charlie.brown@example.com', 'Referral', 'new'),
('Diana', 'Prince', 'diana.prince@example.com', 'Google Ads', 'converted'),
('Evan', 'Wright', 'evan.wright@example.com', 'Direct', 'lost');

INSERT INTO campaigns (name, type, status, budget, start_date, end_date) VALUES
('Summer Sale 2026', 'email', 'active', 5000.00, '2026-06-01', '2026-06-30'),
('Retargeting Ads Q2', 'ads', 'active', 15000.00, '2026-04-01', '2026-06-30'),
('Influencer Partnership', 'social', 'draft', 10000.00, '2026-07-01', '2026-07-31');

INSERT INTO email_logs (campaign_id, lead_id, subject, status) VALUES
(1, 1, 'Get ready for Summer!', 'opened'),
(1, 2, 'Get ready for Summer!', 'sent'),
(1, 3, 'Get ready for Summer!', 'clicked'),
(1, 4, 'Get ready for Summer!', 'bounced');

INSERT INTO support_tickets (lead_id, subject, description, status, priority) VALUES
(1, 'Cannot access account', 'User forgot password and reset link is not working.', 'in_progress', 'high'),
(2, 'Question about pricing', 'Wants to know if there is a discount for annual billing.', 'open', 'medium'),
(4, 'Feedback on recent purchase', 'The product was great but shipping was slow.', 'resolved', 'low');

-- ══════════════════════════════════════════════════════════════
-- End of Script
-- ══════════════════════════════════════════════════════════════
