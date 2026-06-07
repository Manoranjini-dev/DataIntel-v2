-- ══════════════════════════════════════════════════════════════
-- E-Commerce Database — Schema + Seed Data
-- ══════════════════════════════════════════════════════════════

DROP DATABASE IF EXISTS ecommerce;
CREATE DATABASE ecommerce CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE ecommerce;

-- ── Schema ─────────────────────────────────────────────────

CREATE TABLE customers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  first_name VARCHAR(50) NOT NULL,
  last_name VARCHAR(50) NOT NULL,
  email VARCHAR(120) NOT NULL UNIQUE,
  phone VARCHAR(20),
  password_hash VARCHAR(255) NOT NULL,
  date_of_birth DATE,
  gender ENUM('male','female','other') DEFAULT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_email (email),
  INDEX idx_active (is_active)
) ENGINE=InnoDB;

CREATE TABLE addresses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT NOT NULL,
  label VARCHAR(30) DEFAULT 'home',
  street_line1 VARCHAR(150) NOT NULL,
  street_line2 VARCHAR(150),
  city VARCHAR(80) NOT NULL,
  state VARCHAR(80) NOT NULL,
  postal_code VARCHAR(20) NOT NULL,
  country VARCHAR(60) NOT NULL DEFAULT 'United States',
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  slug VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  parent_id INT DEFAULT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE SET NULL,
  INDEX idx_slug (slug)
) ENGINE=InnoDB;

CREATE TABLE brands (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  slug VARCHAR(100) NOT NULL UNIQUE,
  logo_url VARCHAR(255),
  website VARCHAR(255),
  description TEXT,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sku VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  slug VARCHAR(220) NOT NULL UNIQUE,
  description TEXT,
  category_id INT NOT NULL,
  brand_id INT,
  price DECIMAL(10,2) NOT NULL,
  compare_at_price DECIMAL(10,2) DEFAULT NULL,
  cost_price DECIMAL(10,2) DEFAULT NULL,
  weight_kg DECIMAL(6,3) DEFAULT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  is_featured TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES categories(id),
  FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE SET NULL,
  INDEX idx_category (category_id),
  INDEX idx_brand (brand_id),
  INDEX idx_price (price),
  INDEX idx_featured (is_featured)
) ENGINE=InnoDB;

CREATE TABLE product_images (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  url VARCHAR(255) NOT NULL,
  alt_text VARCHAR(200),
  sort_order INT NOT NULL DEFAULT 0,
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE inventory (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL UNIQUE,
  quantity INT NOT NULL DEFAULT 0,
  reserved INT NOT NULL DEFAULT 0,
  reorder_level INT NOT NULL DEFAULT 10,
  reorder_quantity INT NOT NULL DEFAULT 50,
  warehouse_location VARCHAR(30),
  last_restocked_at DATETIME,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  INDEX idx_low_stock (quantity, reorder_level)
) ENGINE=InnoDB;

CREATE TABLE coupons (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(30) NOT NULL UNIQUE,
  description VARCHAR(200),
  discount_type ENUM('percentage','fixed') NOT NULL,
  discount_value DECIMAL(10,2) NOT NULL,
  min_order_amount DECIMAL(10,2) DEFAULT 0,
  max_uses INT DEFAULT NULL,
  times_used INT NOT NULL DEFAULT 0,
  starts_at DATETIME NOT NULL,
  expires_at DATETIME NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_code (code)
) ENGINE=InnoDB;

CREATE TABLE orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_number VARCHAR(20) NOT NULL UNIQUE,
  customer_id INT NOT NULL,
  shipping_address_id INT,
  billing_address_id INT,
  coupon_id INT DEFAULT NULL,
  status ENUM('pending','processing','shipped','delivered','cancelled','refunded') NOT NULL DEFAULT 'pending',
  subtotal DECIMAL(10,2) NOT NULL,
  discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  shipping_cost DECIMAL(10,2) NOT NULL DEFAULT 0,
  tax_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  total DECIMAL(10,2) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  notes TEXT,
  ordered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  shipped_at DATETIME DEFAULT NULL,
  delivered_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (shipping_address_id) REFERENCES addresses(id) ON DELETE SET NULL,
  FOREIGN KEY (billing_address_id) REFERENCES addresses(id) ON DELETE SET NULL,
  FOREIGN KEY (coupon_id) REFERENCES coupons(id) ON DELETE SET NULL,
  INDEX idx_customer (customer_id),
  INDEX idx_status (status),
  INDEX idx_ordered_at (ordered_at),
  INDEX idx_order_number (order_number)
) ENGINE=InnoDB;

CREATE TABLE order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  product_id INT NOT NULL,
  quantity INT NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  total_price DECIMAL(10,2) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id),
  INDEX idx_order (order_id),
  INDEX idx_product (product_id)
) ENGINE=InnoDB;

CREATE TABLE payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  method ENUM('credit_card','debit_card','paypal','bank_transfer','crypto') NOT NULL,
  status ENUM('pending','completed','failed','refunded') NOT NULL DEFAULT 'pending',
  amount DECIMAL(10,2) NOT NULL,
  transaction_id VARCHAR(100),
  paid_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  INDEX idx_order (order_id),
  INDEX idx_status (status)
) ENGINE=InnoDB;

CREATE TABLE shipments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  carrier VARCHAR(50) NOT NULL,
  tracking_number VARCHAR(100),
  status ENUM('label_created','in_transit','out_for_delivery','delivered','returned') NOT NULL DEFAULT 'label_created',
  estimated_delivery DATE,
  actual_delivery DATE,
  shipping_cost DECIMAL(10,2) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  INDEX idx_order (order_id),
  INDEX idx_tracking (tracking_number)
) ENGINE=InnoDB;

CREATE TABLE reviews (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  customer_id INT NOT NULL,
  rating TINYINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title VARCHAR(150),
  body TEXT,
  is_verified_purchase TINYINT(1) NOT NULL DEFAULT 0,
  is_approved TINYINT(1) NOT NULL DEFAULT 1,
  helpful_count INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  INDEX idx_product (product_id),
  INDEX idx_customer (customer_id),
  INDEX idx_rating (rating)
) ENGINE=InnoDB;

CREATE TABLE wishlists (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT NOT NULL,
  product_id INT NOT NULL,
  added_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  UNIQUE KEY uk_wish (customer_id, product_id)
) ENGINE=InnoDB;

CREATE TABLE cart_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT NOT NULL,
  product_id INT NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  added_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  UNIQUE KEY uk_cart (customer_id, product_id)
) ENGINE=InnoDB;

-- ══════════════════════════════════════════════════════════════
-- SEED DATA
-- ══════════════════════════════════════════════════════════════

-- ── Customers (200) ────────────────────────────────────────

INSERT INTO customers (first_name, last_name, email, phone, password_hash, date_of_birth, gender) VALUES
('James','Smith','james.smith@email.com','555-0101','$2b$10$hash1','1985-03-15','male'),
('Maria','Garcia','maria.garcia@email.com','555-0102','$2b$10$hash2','1990-07-22','female'),
('Robert','Johnson','robert.johnson@email.com','555-0103','$2b$10$hash3','1978-11-08','male'),
('Jennifer','Williams','jennifer.williams@email.com','555-0104','$2b$10$hash4','1992-01-30','female'),
('Michael','Brown','michael.brown@email.com','555-0105','$2b$10$hash5','1988-05-12','male'),
('Linda','Jones','linda.jones@email.com','555-0106','$2b$10$hash6','1995-09-18','female'),
('David','Miller','david.miller@email.com','555-0107','$2b$10$hash7','1982-12-03','male'),
('Elizabeth','Davis','elizabeth.davis@email.com','555-0108','$2b$10$hash8','1991-04-25','female'),
('William','Martinez','william.martinez@email.com','555-0109','$2b$10$hash9','1975-08-14','male'),
('Susan','Anderson','susan.anderson@email.com','555-0110','$2b$10$hash10','1993-06-07','female'),
('Richard','Taylor','richard.taylor@email.com','555-0111','$2b$10$hash11','1987-02-19','male'),
('Jessica','Thomas','jessica.thomas@email.com','555-0112','$2b$10$hash12','1994-10-31','female'),
('Joseph','Hernandez','joseph.hernandez@email.com','555-0113','$2b$10$hash13','1980-07-16','male'),
('Sarah','Moore','sarah.moore@email.com','555-0114','$2b$10$hash14','1996-03-22','female'),
('Thomas','Martin','thomas.martin@email.com','555-0115','$2b$10$hash15','1983-11-09','male'),
('Karen','Jackson','karen.jackson@email.com','555-0116','$2b$10$hash16','1989-08-04','female'),
('Christopher','Thompson','christopher.thompson@email.com','555-0117','$2b$10$hash17','1976-01-27','male'),
('Lisa','White','lisa.white@email.com','555-0118','$2b$10$hash18','1997-12-15','female'),
('Daniel','Lopez','daniel.lopez@email.com','555-0119','$2b$10$hash19','1984-06-20','male'),
('Nancy','Lee','nancy.lee@email.com','555-0120','$2b$10$hash20','1991-09-11','female'),
('Matthew','Gonzalez','matthew.gonzalez@email.com','555-0121','$2b$10$hash21','1986-04-03','male'),
('Betty','Harris','betty.harris@email.com','555-0122','$2b$10$hash22','1993-07-28','female'),
('Anthony','Clark','anthony.clark@email.com','555-0123','$2b$10$hash23','1979-10-14','male'),
('Margaret','Lewis','margaret.lewis@email.com','555-0124','$2b$10$hash24','1995-02-06','female'),
('Mark','Robinson','mark.robinson@email.com','555-0125','$2b$10$hash25','1981-05-30','male'),
('Sandra','Walker','sandra.walker@email.com','555-0126','$2b$10$hash26','1990-11-17','female'),
('Donald','Perez','donald.perez@email.com','555-0127','$2b$10$hash27','1977-03-09','male'),
('Ashley','Hall','ashley.hall@email.com','555-0128','$2b$10$hash28','1998-08-21','female'),
('Steven','Young','steven.young@email.com','555-0129','$2b$10$hash29','1985-12-12','male'),
('Dorothy','Allen','dorothy.allen@email.com','555-0130','$2b$10$hash30','1992-06-04','female'),
('Paul','Sanchez','paul.sanchez@email.com','555-0131','$2b$10$hash31','1988-09-26','male'),
('Kimberly','Wright','kimberly.wright@email.com','555-0132','$2b$10$hash32','1994-01-18','female'),
('Andrew','King','andrew.king@email.com','555-0133','$2b$10$hash33','1980-04-10','male'),
('Emily','Scott','emily.scott@email.com','555-0134','$2b$10$hash34','1996-07-02','female'),
('Joshua','Green','joshua.green@email.com','555-0135','$2b$10$hash35','1983-10-24','male'),
('Donna','Baker','donna.baker@email.com','555-0136','$2b$10$hash36','1989-05-16','female'),
('Kenneth','Adams','kenneth.adams@email.com','555-0137','$2b$10$hash37','1976-08-08','male'),
('Michelle','Nelson','michelle.nelson@email.com','555-0138','$2b$10$hash38','1997-03-31','female'),
('Kevin','Hill','kevin.hill@email.com','555-0139','$2b$10$hash39','1984-11-22','male'),
('Carol','Ramirez','carol.ramirez@email.com','555-0140','$2b$10$hash40','1991-02-14','female'),
('Brian','Campbell','brian.campbell@email.com','555-0141','$2b$10$hash41','1987-07-06','male'),
('Amanda','Mitchell','amanda.mitchell@email.com','555-0142','$2b$10$hash42','1993-12-28','female'),
('George','Roberts','george.roberts@email.com','555-0143','$2b$10$hash43','1979-05-20','male'),
('Stephanie','Carter','stephanie.carter@email.com','555-0144','$2b$10$hash44','1995-10-12','female'),
('Edward','Phillips','edward.phillips@email.com','555-0145','$2b$10$hash45','1982-01-04','male'),
('Rebecca','Evans','rebecca.evans@email.com','555-0146','$2b$10$hash46','1990-06-26','female'),
('Ronald','Turner','ronald.turner@email.com','555-0147','$2b$10$hash47','1977-09-18','male'),
('Sharon','Torres','sharon.torres@email.com','555-0148','$2b$10$hash48','1998-04-10','female'),
('Timothy','Parker','timothy.parker@email.com','555-0149','$2b$10$hash49','1985-08-02','male'),
('Laura','Collins','laura.collins@email.com','555-0150','$2b$10$hash50','1992-11-24','female'),
('Jason','Edwards','jason.edwards@email.com','555-0151','$2b$10$hash51','1986-03-17','male'),
('Deborah','Stewart','deborah.stewart@email.com','555-0152','$2b$10$hash52','1994-08-09','female'),
('Ryan','Flores','ryan.flores@email.com','555-0153','$2b$10$hash53','1981-11-01','male'),
('Carolyn','Morris','carolyn.morris@email.com','555-0154','$2b$10$hash54','1996-02-22','female'),
('Jacob','Nguyen','jacob.nguyen@email.com','555-0155','$2b$10$hash55','1983-06-14','male'),
('Janet','Murphy','janet.murphy@email.com','555-0156','$2b$10$hash56','1989-01-06','female'),
('Gary','Rivera','gary.rivera@email.com','555-0157','$2b$10$hash57','1978-04-28','male'),
('Catherine','Cook','catherine.cook@email.com','555-0158','$2b$10$hash58','1997-09-20','female'),
('Nicholas','Rogers','nicholas.rogers@email.com','555-0159','$2b$10$hash59','1984-12-12','male'),
('Heather','Morgan','heather.morgan@email.com','555-0160','$2b$10$hash60','1991-05-04','female'),
('Eric','Peterson','eric.peterson@email.com','555-0161','$2b$10$hash61','1987-08-26','male'),
('Helen','Cooper','helen.cooper@email.com','555-0162','$2b$10$hash62','1993-03-18','female'),
('Jonathan','Reed','jonathan.reed@email.com','555-0163','$2b$10$hash63','1980-06-10','male'),
('Samantha','Bailey','samantha.bailey@email.com','555-0164','$2b$10$hash64','1995-11-02','female'),
('Stephen','Bell','stephen.bell@email.com','555-0165','$2b$10$hash65','1982-02-24','male'),
('Christine','Gomez','christine.gomez@email.com','555-0166','$2b$10$hash66','1990-07-16','female'),
('Larry','Kelly','larry.kelly@email.com','555-0167','$2b$10$hash67','1977-10-08','male'),
('Katherine','Howard','katherine.howard@email.com','555-0168','$2b$10$hash68','1998-05-30','female'),
('Frank','Ward','frank.ward@email.com','555-0169','$2b$10$hash69','1985-09-22','male'),
('Virginia','Cox','virginia.cox@email.com','555-0170','$2b$10$hash70','1992-12-14','female'),
('Scott','Diaz','scott.diaz@email.com','555-0171','$2b$10$hash71','1988-03-06','male'),
('Debra','Richardson','debra.richardson@email.com','555-0172','$2b$10$hash72','1994-08-28','female'),
('Brandon','Wood','brandon.wood@email.com','555-0173','$2b$10$hash73','1981-11-20','male'),
('Rachel','Watson','rachel.watson@email.com','555-0174','$2b$10$hash74','1996-04-12','female'),
('Benjamin','Brooks','benjamin.brooks@email.com','555-0175','$2b$10$hash75','1983-07-04','male'),
('Brenda','Bennett','brenda.bennett@email.com','555-0176','$2b$10$hash76','1989-12-26','female'),
('Samuel','Gray','samuel.gray@email.com','555-0177','$2b$10$hash77','1976-05-18','male'),
('Diane','James','diane.james@email.com','555-0178','$2b$10$hash78','1997-10-10','female'),
('Gregory','Reyes','gregory.reyes@email.com','555-0179','$2b$10$hash79','1984-01-02','male'),
('Cynthia','Cruz','cynthia.cruz@email.com','555-0180','$2b$10$hash80','1991-06-24','female'),
('Alexander','Hughes','alexander.hughes@email.com','555-0181','$2b$10$hash81','1987-09-16','male'),
('Amy','Price','amy.price@email.com','555-0182','$2b$10$hash82','1993-02-07','female'),
('Patrick','Myers','patrick.myers@email.com','555-0183','$2b$10$hash83','1980-05-30','male'),
('Angela','Long','angela.long@email.com','555-0184','$2b$10$hash84','1995-10-22','female'),
('Raymond','Foster','raymond.foster@email.com','555-0185','$2b$10$hash85','1982-01-14','male'),
('Melissa','Sanders','melissa.sanders@email.com','555-0186','$2b$10$hash86','1990-06-06','female'),
('Jack','Ross','jack.ross@email.com','555-0187','$2b$10$hash87','1977-09-28','male'),
('Julie','Powell','julie.powell@email.com','555-0188','$2b$10$hash88','1998-04-20','female'),
('Dennis','Sullivan','dennis.sullivan@email.com','555-0189','$2b$10$hash89','1985-08-12','male'),
('Emma','Russell','emma.russell@email.com','555-0190','$2b$10$hash90','1992-11-03','female'),
('Jerry','Ortiz','jerry.ortiz@email.com','555-0191','$2b$10$hash91','1988-02-25','male'),
('Megan','Jenkins','megan.jenkins@email.com','555-0192','$2b$10$hash92','1994-07-17','female'),
('Tyler','Gutierrez','tyler.gutierrez@email.com','555-0193','$2b$10$hash93','1981-10-09','male'),
('Diana','Perry','diana.perry@email.com','555-0194','$2b$10$hash94','1996-03-01','female'),
('Aaron','Butler','aaron.butler@email.com','555-0195','$2b$10$hash95','1983-06-23','male'),
('Natalie','Barnes','natalie.barnes@email.com','555-0196','$2b$10$hash96','1989-11-15','female'),
('Henry','Fisher','henry.fisher@email.com','555-0197','$2b$10$hash97','1978-04-07','male'),
('Gloria','Henderson','gloria.henderson@email.com','555-0198','$2b$10$hash98','1997-09-29','female'),
('Jose','Coleman','jose.coleman@email.com','555-0199','$2b$10$hash99','1984-12-21','male'),
('Teresa','Simmons','teresa.simmons@email.com','555-0200','$2b$10$hash100','1991-05-13','female'),
('Adam','Patterson','adam.patterson@email.com','555-0201','$2b$10$hash101','1986-08-05','male'),
('Sara','Jordan','sara.jordan@email.com','555-0202','$2b$10$hash102','1993-01-27','female'),
('Nathan','Reynolds','nathan.reynolds@email.com','555-0203','$2b$10$hash103','1980-04-19','male'),
('Janice','Hamilton','janice.hamilton@email.com','555-0204','$2b$10$hash104','1995-09-11','female'),
('Douglas','Graham','douglas.graham@email.com','555-0205','$2b$10$hash105','1982-12-03','male'),
('Nicole','Kim','nicole.kim@email.com','555-0206','$2b$10$hash106','1990-05-26','female'),
('Peter','Gonzales','peter.gonzales@email.com','555-0207','$2b$10$hash107','1977-08-18','male'),
('Judy','Nelson','judy.nelson2@email.com','555-0208','$2b$10$hash108','1998-03-10','female'),
('Carl','Alexander','carl.alexander@email.com','555-0209','$2b$10$hash109','1985-06-02','male'),
('Christina','Stone','christina.stone@email.com','555-0210','$2b$10$hash110','1992-10-24','female'),
('Roger','Webb','roger.webb@email.com','555-0211','$2b$10$hash111','1988-01-16','male'),
('Joyce','Freeman','joyce.freeman@email.com','555-0212','$2b$10$hash112','1994-06-08','female'),
('Keith','Dixon','keith.dixon@email.com','555-0213','$2b$10$hash113','1981-09-30','male'),
('Marie','Burns','marie.burns@email.com','555-0214','$2b$10$hash114','1996-02-22','female'),
('Wayne','Gordon','wayne.gordon@email.com','555-0215','$2b$10$hash115','1983-05-14','male'),
('Lori','Chavez','lori.chavez@email.com','555-0216','$2b$10$hash116','1989-10-06','female'),
('Russell','Crawford','russell.crawford@email.com','555-0217','$2b$10$hash117','1976-01-28','male'),
('Victoria','Vasquez','victoria.vasquez@email.com','555-0218','$2b$10$hash118','1997-08-20','female'),
('Eugene','Olson','eugene.olson@email.com','555-0219','$2b$10$hash119','1984-11-12','male'),
('Cheryl','Palmer','cheryl.palmer@email.com','555-0220','$2b$10$hash120','1991-04-04','female'),
('Philip','Warren','philip.warren@email.com','555-0221','$2b$10$hash121','1987-07-26','male'),
('Jean','Fox','jean.fox@email.com','555-0222','$2b$10$hash122','1993-12-18','female'),
('Zachary','Hunter','zachary.hunter@email.com','555-0223','$2b$10$hash123','1980-03-10','male'),
('Alice','Holmes','alice.holmes@email.com','555-0224','$2b$10$hash124','1995-08-02','female'),
('Terry','Gibson','terry.gibson@email.com','555-0225','$2b$10$hash125','1982-10-24','male'),
('Kelly','Mendoza','kelly.mendoza@email.com','555-0226','$2b$10$hash126','1990-03-16','female'),
('Sean','Snyder','sean.snyder@email.com','555-0227','$2b$10$hash127','1977-06-08','male'),
('Martha','Ruiz','martha.ruiz@email.com','555-0228','$2b$10$hash128','1998-01-30','female'),
('Christian','Carroll','christian.carroll@email.com','555-0229','$2b$10$hash129','1985-04-22','male'),
('Lauren','Duncan','lauren.duncan@email.com','555-0230','$2b$10$hash130','1992-09-14','female'),
('Albert','Mason','albert.mason@email.com','555-0231','$2b$10$hash131','1988-12-06','male'),
('Kathryn','Webb','kathryn.webb2@email.com','555-0232','$2b$10$hash132','1994-05-28','female'),
('Joe','Hart','joe.hart@email.com','555-0233','$2b$10$hash133','1981-08-20','male'),
('Ann','Spencer','ann.spencer@email.com','555-0234','$2b$10$hash134','1996-01-12','female'),
('Ralph','Stephens','ralph.stephens@email.com','555-0235','$2b$10$hash135','1983-04-04','male'),
('Pamela','Tucker','pamela.tucker@email.com','555-0236','$2b$10$hash136','1989-09-26','female'),
('Roy','Porter','roy.porter@email.com','555-0237','$2b$10$hash137','1976-12-18','male'),
('Tammy','Hunter','tammy.hunter@email.com','555-0238','$2b$10$hash138','1997-05-10','female'),
('Louis','Hicks','louis.hicks@email.com','555-0239','$2b$10$hash139','1984-08-02','male'),
('Irene','Crawford','irene.crawford@email.com','555-0240','$2b$10$hash140','1991-01-24','female'),
('Bobby','Boyd','bobby.boyd@email.com','555-0241','$2b$10$hash141','1987-04-16','male'),
('Jane','Mason','jane.mason@email.com','555-0242','$2b$10$hash142','1993-09-08','female'),
('Jesse','Morales','jesse.morales@email.com','555-0243','$2b$10$hash143','1980-12-31','male'),
('Theresa','Kennedy','theresa.kennedy@email.com','555-0244','$2b$10$hash144','1995-05-22','female'),
('Howard','Ferguson','howard.ferguson@email.com','555-0245','$2b$10$hash145','1982-08-14','male'),
('Grace','Rose','grace.rose@email.com','555-0246','$2b$10$hash146','1990-01-06','female'),
('Dylan','Stone','dylan.stone@email.com','555-0247','$2b$10$hash147','1977-03-30','male'),
('Lillian','Hawkins','lillian.hawkins@email.com','555-0248','$2b$10$hash148','1998-08-22','female'),
('Arthur','Dunn','arthur.dunn@email.com','555-0249','$2b$10$hash149','1985-11-14','male'),
('Hannah','Perkins','hannah.perkins@email.com','555-0250','$2b$10$hash150','1992-04-06','female'),
('Oscar','Hudson','oscar.hudson@email.com','555-0251','$2b$10$hash151','1988-07-28','male'),
('Frances','Spencer','frances.spencer@email.com','555-0252','$2b$10$hash152','1994-12-20','female'),
('Logan','Reynolds','logan.reynolds@email.com','555-0253','$2b$10$hash153','1981-03-14','male'),
('Ruth','Arnold','ruth.arnold@email.com','555-0254','$2b$10$hash154','1996-08-06','female'),
('Walter','Black','walter.black@email.com','555-0255','$2b$10$hash155','1983-11-28','male'),
('Evelyn','Grant','evelyn.grant@email.com','555-0256','$2b$10$hash156','1989-04-20','female'),
('Harold','Fox','harold.fox@email.com','555-0257','$2b$10$hash157','1978-07-12','male'),
('Charlotte','Hayes','charlotte.hayes@email.com','555-0258','$2b$10$hash158','1997-12-04','female'),
('Gerald','Fisher','gerald.fisher@email.com','555-0259','$2b$10$hash159','1984-02-26','male'),
('Abigail','Kim','abigail.kim@email.com','555-0260','$2b$10$hash160','1991-07-18','female'),
('Bruce','Wells','bruce.wells@email.com','555-0261','$2b$10$hash161','1987-10-10','male'),
('Ruby','Andrews','ruby.andrews@email.com','555-0262','$2b$10$hash162','1993-03-02','female'),
('Vincent','Silva','vincent.silva@email.com','555-0263','$2b$10$hash163','1980-06-24','male'),
('Sophia','Murray','sophia.murray@email.com','555-0264','$2b$10$hash164','1995-11-16','female'),
('Alan','Hoffman','alan.hoffman@email.com','555-0265','$2b$10$hash165','1982-02-08','male'),
('Kayla','Perez','kayla.perez@email.com','555-0266','$2b$10$hash166','1990-07-01','female'),
('Randy','Weber','randy.weber@email.com','555-0267','$2b$10$hash167','1977-09-23','male'),
('Mia','Owen','mia.owen@email.com','555-0268','$2b$10$hash168','1998-04-15','female'),
('Juan','Castillo','juan.castillo@email.com','555-0269','$2b$10$hash169','1985-07-07','male'),
('Isabella','Bishop','isabella.bishop@email.com','555-0270','$2b$10$hash170','1992-11-29','female'),
('Philip','Herrera','philip.herrera@email.com','555-0271','$2b$10$hash171','1988-02-20','male'),
('Olivia','Snyder','olivia.snyder@email.com','555-0272','$2b$10$hash172','1994-07-12','female'),
('Travis','Day','travis.day@email.com','555-0273','$2b$10$hash173','1981-10-04','male'),
('Zoe','Walsh','zoe.walsh@email.com','555-0274','$2b$10$hash174','1996-02-26','female'),
('Martin','Mills','martin.mills@email.com','555-0275','$2b$10$hash175','1983-05-18','male'),
('Aria','Salazar','aria.salazar@email.com','555-0276','$2b$10$hash176','1989-10-10','female'),
('Dale','Daniels','dale.daniels@email.com','555-0277','$2b$10$hash177','1976-01-02','male'),
('Nora','Lawrence','nora.lawrence@email.com','555-0278','$2b$10$hash178','1997-06-24','female'),
('Lance','Floyd','lance.floyd@email.com','555-0279','$2b$10$hash179','1984-09-16','male'),
('Stella','Garrett','stella.garrett@email.com','555-0280','$2b$10$hash180','1991-02-08','female'),
('Victor','Harper','victor.harper@email.com','555-0281','$2b$10$hash181','1987-05-01','male'),
('Leah','Barker','leah.barker@email.com','555-0282','$2b$10$hash182','1993-09-23','female'),
('Dustin','Marsh','dustin.marsh@email.com','555-0283','$2b$10$hash183','1980-12-15','male'),
('Autumn','Lambert','autumn.lambert@email.com','555-0284','$2b$10$hash184','1995-05-07','female'),
('Clifford','Blair','clifford.blair@email.com','555-0285','$2b$10$hash185','1982-07-30','male'),
('Hazel','Bates','hazel.bates@email.com','555-0286','$2b$10$hash186','1990-12-22','female'),
('Derrick','Floyd','derrick.floyd@email.com','555-0287','$2b$10$hash187','1977-03-16','male'),
('Violet','Schultz','violet.schultz@email.com','555-0288','$2b$10$hash188','1998-08-08','female'),
('Kurt','Holt','kurt.holt@email.com','555-0289','$2b$10$hash189','1985-10-31','male'),
('Ivy','Soto','ivy.soto@email.com','555-0290','$2b$10$hash190','1992-03-23','female'),
('Max','Quinn','max.quinn@email.com','555-0291','$2b$10$hash191','1988-06-15','male'),
('Luna','Vaughn','luna.vaughn@email.com','555-0292','$2b$10$hash192','1994-11-07','female'),
('Felix','Frank','felix.frank@email.com','555-0293','$2b$10$hash193','1981-01-30','male'),
('Jade','Mcdonald','jade.mcdonald@email.com','555-0294','$2b$10$hash194','1996-06-22','female'),
('Ivan','Bush','ivan.bush@email.com','555-0295','$2b$10$hash195','1983-09-14','male'),
('Clara','Chambers','clara.chambers@email.com','555-0296','$2b$10$hash196','1989-02-06','female'),
('Blake','Payne','blake.payne@email.com','555-0297','$2b$10$hash197','1978-04-28','male'),
('Willow','Pope','willow.pope@email.com','555-0298','$2b$10$hash198','1997-09-20','female'),
('Reid','Norris','reid.norris@email.com','555-0299','$2b$10$hash199','1984-12-12','male'),
('Daisy','Hartman','daisy.hartman@email.com','555-0300','$2b$10$hash200','1991-05-04','female');

-- ── Addresses (300) ────────────────────────────────────────

INSERT INTO addresses (customer_id, label, street_line1, city, state, postal_code, country, is_default) VALUES
(1,'home','123 Oak Street','New York','NY','10001','United States',1),
(1,'work','456 Broadway Ave','New York','NY','10002','United States',0),
(2,'home','789 Elm Drive','Los Angeles','CA','90001','United States',1),
(3,'home','321 Pine Road','Chicago','IL','60601','United States',1),
(3,'work','654 Michigan Ave','Chicago','IL','60602','United States',0),
(4,'home','987 Maple Lane','Houston','TX','77001','United States',1),
(5,'home','147 Cedar Blvd','Phoenix','AZ','85001','United States',1),
(6,'home','258 Birch Court','Philadelphia','PA','19101','United States',1),
(7,'home','369 Walnut Way','San Antonio','TX','78201','United States',1),
(8,'home','481 Spruce St','San Diego','CA','92101','United States',1),
(9,'home','592 Ash Avenue','Dallas','TX','75201','United States',1),
(10,'home','603 Cherry Lane','San Jose','CA','95101','United States',1),
(11,'home','714 Poplar Drive','Austin','TX','73301','United States',1),
(12,'home','825 Willow Rd','Jacksonville','FL','32099','United States',1),
(13,'home','936 Hickory Blvd','San Francisco','CA','94101','United States',1),
(14,'home','147 Magnolia St','Columbus','OH','43085','United States',1),
(15,'home','258 Dogwood Ct','Indianapolis','IN','46201','United States',1),
(16,'home','369 Sycamore Ave','Fort Worth','TX','76101','United States',1),
(17,'home','481 Redwood Way','Charlotte','NC','28201','United States',1),
(18,'home','592 Palm Drive','Seattle','WA','98101','United States',1),
(19,'home','603 Cypress Lane','Denver','CO','80201','United States',1),
(20,'home','714 Holly Road','Nashville','TN','37201','United States',1);

-- Generate remaining addresses for customers 21-200
INSERT INTO addresses (customer_id, label, street_line1, city, state, postal_code, country, is_default)
SELECT id, 'home',
  CONCAT(FLOOR(100 + RAND()*900), ' ', ELT(1+FLOOR(RAND()*8),'Main','Park','Lake','Hill','River','Valley','Forest','Ocean'), ' ',
  ELT(1+FLOOR(RAND()*5),'St','Ave','Blvd','Dr','Ln')),
  ELT(1+FLOOR(RAND()*20),'New York','Los Angeles','Chicago','Houston','Phoenix','Philadelphia','San Antonio','San Diego','Dallas','San Jose','Austin','Jacksonville','San Francisco','Columbus','Indianapolis','Fort Worth','Charlotte','Seattle','Denver','Nashville'),
  ELT(1+FLOOR(RAND()*20),'NY','CA','IL','TX','AZ','PA','TX','CA','TX','CA','TX','FL','CA','OH','IN','TX','NC','WA','CO','TN'),
  LPAD(FLOOR(10000 + RAND()*90000), 5, '0'),
  'United States', 1
FROM customers WHERE id > 20;

-- ── Categories ─────────────────────────────────────────────

INSERT INTO categories (id, name, slug, description, parent_id, sort_order) VALUES
(1,'Electronics','electronics','Electronic devices and gadgets',NULL,1),
(2,'Computers & Laptops','computers-laptops','Desktop and laptop computers',1,1),
(3,'Smartphones','smartphones','Mobile phones and accessories',1,2),
(4,'Audio','audio','Headphones, speakers, and audio equipment',1,3),
(5,'Cameras','cameras','Digital cameras and photography gear',1,4),
(6,'Clothing','clothing','Apparel and fashion',NULL,2),
(7,'Men\'s Clothing','mens-clothing','Men\'s apparel',6,1),
(8,'Women\'s Clothing','womens-clothing','Women\'s apparel',6,2),
(9,'Kids\' Clothing','kids-clothing','Children\'s apparel',6,3),
(10,'Home & Garden','home-garden','Home improvement and garden supplies',NULL,3),
(11,'Furniture','furniture','Home and office furniture',10,1),
(12,'Kitchen','kitchen','Kitchen appliances and tools',10,2),
(13,'Decor','decor','Home decoration items',10,3),
(14,'Sports & Outdoors','sports-outdoors','Sporting goods and outdoor gear',NULL,4),
(15,'Fitness','fitness','Exercise and fitness equipment',14,1),
(16,'Cycling','cycling','Bikes and cycling accessories',14,2),
(17,'Camping','camping','Camping and hiking gear',14,3),
(18,'Books','books','Books, eBooks, and publications',NULL,5),
(19,'Fiction','fiction','Fiction books',18,1),
(20,'Non-Fiction','non-fiction','Non-fiction books',18,2),
(21,'Tech Books','tech-books','Technology and programming books',18,3),
(22,'Health & Beauty','health-beauty','Health, beauty and personal care',NULL,6),
(23,'Skincare','skincare','Skincare products',22,1),
(24,'Supplements','supplements','Vitamins and supplements',22,2),
(25,'Toys & Games','toys-games','Toys, games and entertainment',NULL,7);

-- ── Brands ─────────────────────────────────────────────────

INSERT INTO brands (id, name, slug, logo_url, website, description) VALUES
(1,'TechPro','techpro','/brands/techpro.svg','https://techpro.example.com','Premium tech accessories'),
(2,'Zenith Electronics','zenith-electronics','/brands/zenith.svg','https://zenith.example.com','Consumer electronics'),
(3,'UrbanStyle','urbanstyle','/brands/urbanstyle.svg','https://urbanstyle.example.com','Modern fashion brand'),
(4,'HomeNest','homenest','/brands/homenest.svg','https://homenest.example.com','Home furnishing'),
(5,'FitLife','fitlife','/brands/fitlife.svg','https://fitlife.example.com','Fitness equipment'),
(6,'PageTurn','pageturn','/brands/pageturn.svg','https://pageturn.example.com','Book publisher'),
(7,'NaturGlow','naturglow','/brands/naturglow.svg','https://naturglow.example.com','Natural beauty products'),
(8,'SwiftGear','swiftgear','/brands/swiftgear.svg','https://swiftgear.example.com','Sports equipment'),
(9,'PixelCraft','pixelcraft','/brands/pixelcraft.svg','https://pixelcraft.example.com','Photography gear'),
(10,'SoundWave','soundwave','/brands/soundwave.svg','https://soundwave.example.com','Audio equipment'),
(11,'Apex Outdoors','apex-outdoors','/brands/apex.svg','https://apex.example.com','Outdoor adventure gear'),
(12,'KidZone','kidzone','/brands/kidzone.svg','https://kidzone.example.com','Children\'s products'),
(13,'GreenLeaf','greenleaf','/brands/greenleaf.svg','https://greenleaf.example.com','Eco-friendly products'),
(14,'EliteCook','elitecook','/brands/elitecook.svg','https://elitecook.example.com','Premium kitchenware'),
(15,'ByteBooks','bytebooks','/brands/bytebooks.svg','https://bytebooks.example.com','Tech publications');

-- ── Products (150) ─────────────────────────────────────────

INSERT INTO products (id, sku, name, slug, description, category_id, brand_id, price, compare_at_price, cost_price, weight_kg, is_active, is_featured) VALUES
-- Electronics > Computers
(1,'COMP-001','ProBook Laptop 15"','probook-laptop-15','High-performance laptop with 16GB RAM and 512GB SSD',2,1,1299.99,1499.99,899.99,2.100,1,1),
(2,'COMP-002','UltraSlim Laptop 13"','ultraslim-laptop-13','Ultra-thin laptop for professionals',2,2,999.99,1199.99,699.99,1.400,1,1),
(3,'COMP-003','Gaming Desktop Tower','gaming-desktop-tower','High-end gaming PC with RTX graphics',2,1,1899.99,2199.99,1399.99,12.000,1,1),
(4,'COMP-004','Mini PC Compact','mini-pc-compact','Space-saving mini desktop computer',2,2,549.99,649.99,379.99,0.800,1,0),
(5,'COMP-005','Business Workstation','business-workstation','Enterprise-grade workstation',2,1,2499.99,2899.99,1799.99,15.000,1,0),
-- Electronics > Smartphones
(6,'PHONE-001','Galaxy Ultra X','galaxy-ultra-x','Flagship smartphone with 200MP camera',3,2,1199.99,1299.99,799.99,0.230,1,1),
(7,'PHONE-002','PixelPro 8','pixelpro-8','Pure Android experience with AI features',3,1,899.99,999.99,599.99,0.200,1,1),
(8,'PHONE-003','Budget Phone SE','budget-phone-se','Affordable smartphone for everyone',3,2,299.99,349.99,179.99,0.190,1,0),
(9,'PHONE-004','Foldable Flip Z','foldable-flip-z','Innovative foldable smartphone',3,2,1499.99,1699.99,999.99,0.270,1,1),
(10,'PHONE-005','Phone Mini 6"','phone-mini-6','Compact flagship phone',3,1,749.99,849.99,499.99,0.170,1,0),
-- Electronics > Audio
(11,'AUDIO-001','NoiseCancel Pro Headphones','noisecancel-pro-headphones','Premium wireless ANC headphones',4,10,349.99,399.99,199.99,0.260,1,1),
(12,'AUDIO-002','EarBuds Ultra','earbuds-ultra','True wireless earbuds with spatial audio',4,10,199.99,249.99,109.99,0.055,1,1),
(13,'AUDIO-003','Portable Speaker Boom','portable-speaker-boom','Waterproof Bluetooth speaker',4,10,129.99,159.99,69.99,0.680,1,0),
(14,'AUDIO-004','Studio Monitor Pair','studio-monitor-pair','Professional studio monitors',4,10,599.99,699.99,399.99,8.500,1,0),
(15,'AUDIO-005','Soundbar Home Theater','soundbar-home-theater','Dolby Atmos soundbar system',4,10,449.99,549.99,299.99,4.200,1,1),
-- Electronics > Cameras
(16,'CAM-001','DSLR Pro Mark IV','dslr-pro-mark-iv','Professional full-frame DSLR camera',5,9,2799.99,3199.99,1899.99,1.100,1,1),
(17,'CAM-002','Mirrorless Alpha 7','mirrorless-alpha-7','Compact mirrorless with 4K video',5,9,1999.99,2299.99,1399.99,0.650,1,1),
(18,'CAM-003','Action Cam Hero','action-cam-hero','Waterproof 5K action camera',5,9,399.99,449.99,249.99,0.150,1,0),
(19,'CAM-004','Instant Print Camera','instant-print-camera','Fun instant print camera',5,9,89.99,109.99,49.99,0.300,1,0),
(20,'CAM-005','Drone SkyView Pro','drone-skyview-pro','4K aerial photography drone',5,9,899.99,1099.99,599.99,0.900,1,1),
-- Clothing > Men's
(21,'MCLOTH-001','Classic Fit Oxford Shirt','classic-fit-oxford-shirt','Premium cotton oxford shirt',7,3,59.99,79.99,24.99,0.300,1,0),
(22,'MCLOTH-002','Slim Chino Pants','slim-chino-pants','Stretch chino trousers',7,3,49.99,69.99,19.99,0.450,1,0),
(23,'MCLOTH-003','Leather Bomber Jacket','leather-bomber-jacket','Genuine leather bomber',7,3,299.99,399.99,149.99,1.800,1,1),
(24,'MCLOTH-004','Merino Wool Sweater','merino-wool-sweater','Fine merino crew neck sweater',7,3,89.99,119.99,39.99,0.350,1,0),
(25,'MCLOTH-005','Tailored Suit 2-Piece','tailored-suit-2piece','Modern fit wool blend suit',7,3,399.99,549.99,199.99,2.200,1,1),
(26,'MCLOTH-006','Casual Denim Jeans','casual-denim-jeans','Relaxed fit denim jeans',7,3,69.99,89.99,29.99,0.700,1,0),
(27,'MCLOTH-007','Performance Polo','performance-polo','Moisture-wicking polo shirt',7,3,44.99,54.99,18.99,0.250,1,0),
(28,'MCLOTH-008','Quilted Vest','quilted-vest','Lightweight quilted vest',7,3,79.99,99.99,34.99,0.400,1,0),
-- Clothing > Women's
(29,'WCLOTH-001','Silk Wrap Dress','silk-wrap-dress','Elegant silk wrap dress',8,3,149.99,199.99,69.99,0.350,1,1),
(30,'WCLOTH-002','High-Rise Skinny Jeans','high-rise-skinny-jeans','Stretchy high-rise jeans',8,3,79.99,99.99,34.99,0.600,1,0),
(31,'WCLOTH-003','Cashmere Cardigan','cashmere-cardigan','Soft cashmere button cardigan',8,3,199.99,269.99,89.99,0.400,1,1),
(32,'WCLOTH-004','Trench Coat Classic','trench-coat-classic','Double-breasted trench coat',8,3,249.99,329.99,119.99,1.500,1,0),
(33,'WCLOTH-005','Yoga Leggings Pro','yoga-leggings-pro','High-waist compression leggings',8,5,59.99,74.99,24.99,0.250,1,0),
(34,'WCLOTH-006','Linen Blouse','linen-blouse','Breathable linen top',8,3,54.99,69.99,22.99,0.200,1,0),
(35,'WCLOTH-007','Pleated Midi Skirt','pleated-midi-skirt','Flowing pleated skirt',8,3,69.99,89.99,29.99,0.350,1,0),
-- Clothing > Kids
(36,'KCLOTH-001','Kids Rainbow T-Shirt','kids-rainbow-tshirt','Colorful cotton t-shirt for kids',9,12,19.99,24.99,7.99,0.150,1,0),
(37,'KCLOTH-002','Junior Denim Overalls','junior-denim-overalls','Durable denim overalls',9,12,34.99,44.99,14.99,0.400,1,0),
(38,'KCLOTH-003','Winter Puffer Jacket','winter-puffer-jacket-kids','Warm puffer for cold days',9,12,59.99,79.99,24.99,0.600,1,0),
-- Home > Furniture
(39,'FURN-001','Mid-Century Sofa','mid-century-sofa','Three-seater mid-century modern sofa',11,4,1299.99,1599.99,699.99,45.000,1,1),
(40,'FURN-002','Ergonomic Office Chair','ergonomic-office-chair','Adjustable lumbar support chair',11,4,499.99,599.99,249.99,15.000,1,1),
(41,'FURN-003','Solid Oak Dining Table','solid-oak-dining-table','6-person solid oak table',11,4,899.99,1099.99,499.99,35.000,1,0),
(42,'FURN-004','King Platform Bed Frame','king-platform-bed-frame','Modern platform bed frame',11,4,699.99,899.99,349.99,40.000,1,0),
(43,'FURN-005','Floating Bookshelf Set','floating-bookshelf-set','Set of 3 floating shelves',11,4,79.99,99.99,34.99,3.500,1,0),
(44,'FURN-006','Standing Desk Electric','standing-desk-electric','Height-adjustable electric desk',11,4,649.99,799.99,349.99,28.000,1,1),
-- Home > Kitchen
(45,'KITCH-001','Stainless Steel Cookware Set','stainless-steel-cookware-set','12-piece professional cookware',12,14,299.99,399.99,149.99,8.500,1,1),
(46,'KITCH-002','Smart Blender Pro','smart-blender-pro','Programmable high-speed blender',12,14,179.99,219.99,89.99,3.200,1,0),
(47,'KITCH-003','Espresso Machine Deluxe','espresso-machine-deluxe','Semi-automatic espresso maker',12,14,449.99,549.99,249.99,6.500,1,1),
(48,'KITCH-004','Knife Block Set Chef','knife-block-set-chef','8-piece forged knife set',12,14,199.99,249.99,99.99,2.800,1,0),
(49,'KITCH-005','Air Fryer XL','air-fryer-xl','Large capacity digital air fryer',12,14,129.99,159.99,64.99,5.200,1,0),
(50,'KITCH-006','Cast Iron Dutch Oven','cast-iron-dutch-oven','6-quart enameled dutch oven',12,14,89.99,109.99,44.99,5.800,1,0),
-- Home > Decor
(51,'DECOR-001','Artisan Table Lamp','artisan-table-lamp','Hand-blown glass table lamp',13,4,129.99,159.99,59.99,2.100,1,0),
(52,'DECOR-002','Woven Area Rug 8x10','woven-area-rug-8x10','Handwoven wool area rug',13,4,349.99,449.99,179.99,8.000,1,0),
(53,'DECOR-003','Ceramic Vase Collection','ceramic-vase-collection','Set of 3 modern ceramic vases',13,4,69.99,89.99,29.99,1.800,1,0),
(54,'DECOR-004','Wall Art Canvas 3-Panel','wall-art-canvas-3panel','Abstract triptych wall art',13,4,159.99,199.99,69.99,3.000,1,0),
(55,'DECOR-005','Scented Candle Gift Set','scented-candle-gift-set','6-piece soy wax candle set',13,13,49.99,64.99,19.99,1.500,1,0),
-- Sports > Fitness
(56,'FIT-001','Smart Treadmill X1','smart-treadmill-x1','Connected folding treadmill',15,5,1299.99,1599.99,799.99,55.000,1,1),
(57,'FIT-002','Adjustable Dumbbell Set','adjustable-dumbbell-set','5-50lb adjustable dumbbells pair',15,5,399.99,499.99,199.99,25.000,1,1),
(58,'FIT-003','Yoga Mat Premium','yoga-mat-premium','Extra-thick eco-friendly mat',15,5,49.99,64.99,19.99,1.200,1,0),
(59,'FIT-004','Resistance Bands Kit','resistance-bands-kit','Set of 5 resistance bands',15,5,29.99,39.99,9.99,0.500,1,0),
(60,'FIT-005','Fitness Tracker Band','fitness-tracker-band','Heart rate and sleep tracker',15,5,79.99,99.99,34.99,0.035,1,0),
(61,'FIT-006','Kettlebell Set Cast Iron','kettlebell-set-cast-iron','Set of 3 kettlebells 10/20/35lb',15,5,149.99,189.99,79.99,30.000,1,0),
-- Sports > Cycling
(62,'CYCLE-001','Road Bike Carbon','road-bike-carbon','Lightweight carbon frame road bike',16,8,2499.99,2999.99,1699.99,8.200,1,1),
(63,'CYCLE-002','Mountain Bike Trail','mountain-bike-trail','Full-suspension mountain bike',16,8,1899.99,2299.99,1299.99,13.500,1,0),
(64,'CYCLE-003','E-Bike Commuter','e-bike-commuter','Electric city commuter bike',16,8,1599.99,1899.99,999.99,22.000,1,1),
(65,'CYCLE-004','Bike Helmet Aero','bike-helmet-aero','Aerodynamic road cycling helmet',16,8,129.99,159.99,59.99,0.250,1,0),
(66,'CYCLE-005','Cycling Jersey Pro','cycling-jersey-pro','Breathable cycling jersey',16,8,69.99,89.99,29.99,0.180,1,0),
-- Sports > Camping
(67,'CAMP-001','4-Person Tent Dome','4person-tent-dome','Waterproof dome camping tent',17,11,199.99,249.99,99.99,3.500,1,0),
(68,'CAMP-002','Sleeping Bag -20F','sleeping-bag-minus20f','Extreme cold sleeping bag',17,11,149.99,189.99,74.99,2.200,1,0),
(69,'CAMP-003','Hiking Backpack 65L','hiking-backpack-65l','Large capacity hiking pack',17,11,179.99,219.99,89.99,1.800,1,1),
(70,'CAMP-004','Portable Camping Stove','portable-camping-stove','Compact propane camp stove',17,11,59.99,74.99,29.99,1.100,1,0),
(71,'CAMP-005','LED Lantern Rechargeable','led-lantern-rechargeable','USB-C rechargeable lantern',17,11,34.99,44.99,14.99,0.350,1,0),
-- Books > Fiction
(72,'BOOK-F01','The Last Algorithm','the-last-algorithm','Thriller novel about AI gone rogue',19,6,16.99,19.99,5.99,0.400,1,0),
(73,'BOOK-F02','Ocean of Stars','ocean-of-stars','Sci-fi epic spanning galaxies',19,6,14.99,17.99,4.99,0.380,1,0),
(74,'BOOK-F03','Midnight Garden','midnight-garden','Mystery romance novel',19,6,13.99,16.99,4.49,0.350,1,0),
(75,'BOOK-F04','The Forgotten City','the-forgotten-city','Historical fiction adventure',19,6,15.99,18.99,5.49,0.420,1,0),
(76,'BOOK-F05','Echoes of Tomorrow','echoes-of-tomorrow','Time travel literary fiction',19,6,17.99,21.99,6.49,0.400,1,1),
-- Books > Non-Fiction
(77,'BOOK-N01','Atomic Habits of Leaders','atomic-habits-leaders','Leadership and productivity guide',20,6,24.99,29.99,8.99,0.550,1,1),
(78,'BOOK-N02','The Data Economy','the-data-economy','How data shapes modern business',20,6,22.99,27.99,7.99,0.500,1,0),
(79,'BOOK-N03','Mindful Living','mindful-living','Guide to mindfulness and wellness',20,6,19.99,24.99,6.99,0.400,1,0),
(80,'BOOK-N04','Climate Solutions','climate-solutions','Practical approaches to climate change',20,6,21.99,26.99,7.49,0.480,1,0),
-- Books > Tech
(81,'BOOK-T01','Modern SQL Mastery','modern-sql-mastery','Advanced SQL techniques and patterns',21,15,44.99,54.99,14.99,0.800,1,1),
(82,'BOOK-T02','Cloud Architecture Patterns','cloud-architecture-patterns','Designing scalable cloud systems',21,15,49.99,59.99,16.99,0.850,1,0),
(83,'BOOK-T03','Rust Programming Handbook','rust-programming-handbook','Complete guide to Rust language',21,15,39.99,49.99,12.99,0.750,1,0),
(84,'BOOK-T04','AI/ML Engineering','ai-ml-engineering','Practical machine learning engineering',21,15,54.99,64.99,18.99,0.900,1,1),
(85,'BOOK-T05','TypeScript Deep Dive','typescript-deep-dive','Advanced TypeScript patterns',21,15,42.99,52.99,13.99,0.780,1,0),
-- Health > Skincare
(86,'SKIN-001','Vitamin C Serum','vitamin-c-serum','Brightening vitamin C serum 30ml',23,7,34.99,44.99,12.99,0.100,1,1),
(87,'SKIN-002','Hyaluronic Acid Moisturizer','hyaluronic-acid-moisturizer','Deep hydration face cream 50ml',23,7,29.99,39.99,10.99,0.120,1,0),
(88,'SKIN-003','Retinol Night Cream','retinol-night-cream','Anti-aging retinol cream 50ml',23,7,39.99,49.99,14.99,0.130,1,0),
(89,'SKIN-004','Sunscreen SPF 50','sunscreen-spf-50','Broad spectrum mineral sunscreen',23,7,24.99,29.99,8.99,0.150,1,0),
(90,'SKIN-005','Facial Cleansing Kit','facial-cleansing-kit','3-step cleansing system',23,7,49.99,64.99,19.99,0.400,1,0),
-- Health > Supplements
(91,'SUPP-001','Multivitamin Complete','multivitamin-complete','Daily multivitamin 90 capsules',24,13,24.99,29.99,8.99,0.200,1,0),
(92,'SUPP-002','Omega-3 Fish Oil','omega3-fish-oil','High-potency omega-3 120 softgels',24,13,19.99,24.99,6.99,0.300,1,0),
(93,'SUPP-003','Protein Powder Whey','protein-powder-whey','Vanilla whey protein 2lb',24,13,39.99,49.99,14.99,1.000,1,0),
(94,'SUPP-004','Collagen Peptides','collagen-peptides','Type I & III collagen powder',24,13,29.99,34.99,10.99,0.400,1,0),
(95,'SUPP-005','Pre-Workout Energy','pre-workout-energy','Performance pre-workout 30 servings',24,13,34.99,44.99,12.99,0.350,1,0),
-- Toys
(96,'TOY-001','Building Blocks Mega Set','building-blocks-mega-set','1000-piece creative building set',25,12,49.99,64.99,19.99,1.500,1,1),
(97,'TOY-002','Remote Control Car Pro','remote-control-car-pro','High-speed RC car with camera',25,12,79.99,99.99,34.99,0.800,1,0),
(98,'TOY-003','Board Game Strategy','board-game-strategy','Award-winning strategy game',25,12,39.99,49.99,14.99,1.200,1,0),
(99,'TOY-004','Science Experiment Kit','science-experiment-kit','50 science experiments for kids',25,12,34.99,44.99,12.99,1.000,1,0),
(100,'TOY-005','Plush Animal Collection','plush-animal-collection','Set of 6 soft plush animals',25,12,29.99,39.99,9.99,0.600,1,0),
-- More products to reach 150
(101,'COMP-006','Wireless Keyboard & Mouse','wireless-keyboard-mouse','Ergonomic wireless combo',2,1,79.99,99.99,34.99,0.700,1,0),
(102,'COMP-007','4K Monitor 27"','4k-monitor-27','IPS 4K HDR display',2,2,449.99,549.99,299.99,6.500,1,1),
(103,'COMP-008','USB-C Docking Station','usbc-docking-station','12-in-1 USB-C hub',2,1,129.99,159.99,59.99,0.350,1,0),
(104,'PHONE-006','Phone Case Rugged','phone-case-rugged','Military-grade phone protection',3,1,29.99,39.99,9.99,0.080,1,0),
(105,'PHONE-007','Wireless Charger Pad','wireless-charger-pad','15W fast wireless charger',3,1,34.99,44.99,14.99,0.150,1,0),
(106,'AUDIO-006','DJ Turntable Controller','dj-turntable-controller','Professional DJ controller',4,10,299.99,379.99,169.99,3.500,1,0),
(107,'AUDIO-007','Vinyl Record Player','vinyl-record-player','Retro Bluetooth turntable',4,10,179.99,219.99,89.99,4.200,1,0),
(108,'FURN-007','Recliner Leather Chair','recliner-leather-chair','Power reclining leather chair',11,4,799.99,999.99,449.99,35.000,1,0),
(109,'FURN-008','Coffee Table Modern','coffee-table-modern','Tempered glass coffee table',11,4,249.99,319.99,129.99,18.000,1,0),
(110,'FURN-009','Wardrobe Closet System','wardrobe-closet-system','Modular closet organizer',11,4,599.99,749.99,329.99,42.000,1,0),
(111,'KITCH-007','Toaster Oven Smart','toaster-oven-smart','WiFi-connected toaster oven',12,14,199.99,249.99,99.99,5.500,1,0),
(112,'KITCH-008','Food Processor Deluxe','food-processor-deluxe','14-cup food processor',12,14,149.99,189.99,74.99,4.800,1,0),
(113,'DECOR-006','String Light LED Set','string-light-led-set','Warm white 100ft LED string lights',13,4,24.99,34.99,9.99,0.400,1,0),
(114,'DECOR-007','Macrame Wall Hanging','macrame-wall-hanging','Handmade boho wall hanging',13,13,44.99,59.99,17.99,0.500,1,0),
(115,'FIT-007','Pull-Up Bar Doorway','pullup-bar-doorway','No-screw doorway pull-up bar',15,5,34.99,44.99,14.99,2.500,1,0),
(116,'FIT-008','Exercise Ball 65cm','exercise-ball-65cm','Anti-burst stability ball',15,5,24.99,29.99,9.99,1.200,1,0),
(117,'CYCLE-006','Bike Lock Heavy Duty','bike-lock-heavy-duty','U-lock with cable',16,8,49.99,64.99,19.99,1.400,1,0),
(118,'CAMP-006','Water Filter Portable','water-filter-portable','Backpacking water purifier',17,11,39.99,49.99,17.99,0.200,1,0),
(119,'CAMP-007','Hammock Double','hammock-double','Parachute nylon camping hammock',17,11,29.99,39.99,11.99,0.500,1,0),
(120,'SKIN-006','Eye Cream Anti-Aging','eye-cream-anti-aging','Peptide eye cream 15ml',23,7,27.99,34.99,9.99,0.060,1,0),
(121,'SKIN-007','Face Mask Sheet Pack','face-mask-sheet-pack','10-pack hydrating sheet masks',23,7,16.99,22.99,5.99,0.200,1,0),
(122,'TOY-006','Puzzle 1000 Pieces','puzzle-1000-pieces','World landmark jigsaw puzzle',25,12,19.99,24.99,6.99,0.600,1,0),
(123,'TOY-007','Drone Mini Kids','drone-mini-kids','Easy-fly mini drone for beginners',25,12,49.99,64.99,22.99,0.150,1,0),
(124,'MCLOTH-009','Running Sneakers Aero','running-sneakers-aero','Lightweight running shoes',7,8,119.99,149.99,54.99,0.300,1,1),
(125,'MCLOTH-010','Swim Trunks Board','swim-trunks-board','Quick-dry board shorts',7,8,34.99,44.99,14.99,0.200,1,0),
(126,'WCLOTH-008','Running Shoes Women','running-shoes-women','Women\'s cushioned runners',8,8,109.99,139.99,49.99,0.280,1,0),
(127,'WCLOTH-009','Puffer Jacket Hooded','puffer-jacket-hooded','Packable puffer jacket',8,3,129.99,169.99,59.99,0.500,1,0),
(128,'WCLOTH-010','Sports Bra High Impact','sports-bra-high-impact','High support sports bra',8,5,44.99,54.99,18.99,0.120,1,0),
(129,'BOOK-T06','DevOps Handbook 2nd Ed','devops-handbook-2nd','Modern DevOps practices',21,15,46.99,56.99,15.99,0.820,1,0),
(130,'BOOK-T07','System Design Interview','system-design-interview','Pass your system design interviews',21,15,37.99,47.99,11.99,0.700,1,1),
(131,'BOOK-F06','Silver Linings','silver-linings-novel','Heartwarming family saga',19,6,14.99,18.99,4.99,0.380,1,0),
(132,'BOOK-F07','The Phoenix Protocol','the-phoenix-protocol','Cyber thriller novel',19,6,16.99,20.99,5.99,0.400,1,0),
(133,'SUPP-006','Vitamin D3 5000IU','vitamin-d3-5000iu','High-potency vitamin D 120 caps',24,13,14.99,19.99,4.99,0.150,1,0),
(134,'SUPP-007','Probiotics 50 Billion','probiotics-50billion','Multi-strain probiotic 60 caps',24,13,29.99,37.99,10.99,0.200,1,0),
(135,'SUPP-008','Creatine Monohydrate','creatine-monohydrate','Pure creatine powder 500g',24,13,19.99,24.99,7.99,0.550,1,0),
(136,'CAM-006','Tripod Professional','tripod-professional','Carbon fiber travel tripod',5,9,199.99,249.99,99.99,1.500,1,0),
(137,'CAM-007','Camera Bag Backpack','camera-bag-backpack','Weather-resistant camera backpack',5,9,89.99,109.99,39.99,1.200,1,0),
(138,'KCLOTH-004','Kids Snow Boots','kids-snow-boots','Insulated waterproof boots',9,12,44.99,59.99,19.99,0.500,1,0),
(139,'KCLOTH-005','Girls Summer Dress','girls-summer-dress','Floral cotton sundress',9,12,24.99,34.99,9.99,0.180,1,0),
(140,'KCLOTH-006','Boys Athletic Shorts','boys-athletic-shorts','Moisture-wicking shorts set of 3',9,12,29.99,39.99,11.99,0.250,1,0),
(141,'DECOR-008','Succulent Planter Set','succulent-planter-set','Ceramic planters set of 4',13,13,34.99,44.99,14.99,1.800,1,0),
(142,'DECOR-009','Smart LED Bulbs 4-Pack','smart-led-bulbs-4pack','WiFi color-changing bulbs',13,1,39.99,49.99,17.99,0.400,1,0),
(143,'FIT-009','Foam Roller Recovery','foam-roller-recovery','High-density muscle roller',15,5,19.99,24.99,7.99,0.400,1,0),
(144,'FIT-010','Jump Rope Speed','jump-rope-speed','Adjustable speed jump rope',15,5,14.99,19.99,4.99,0.200,1,0),
(145,'CAMP-008','Headlamp 1000 Lumens','headlamp-1000lumens','Rechargeable LED headlamp',17,11,27.99,34.99,10.99,0.100,1,0),
(146,'CAMP-009','Insulated Water Bottle','insulated-water-bottle-32oz','32oz vacuum insulated bottle',17,11,29.99,39.99,12.99,0.450,1,0),
(147,'TOY-008','Wooden Train Set','wooden-train-set','100-piece wooden railway set',25,12,44.99,59.99,18.99,2.000,1,0),
(148,'TOY-009','Art Supply Kit Kids','art-supply-kit-kids','150-piece deluxe art set',25,12,34.99,44.99,13.99,1.500,1,0),
(149,'AUDIO-008','Microphone USB Studio','microphone-usb-studio','Professional USB condenser mic',4,10,119.99,149.99,54.99,0.650,1,0),
(150,'AUDIO-009','DAC Headphone Amp','dac-headphone-amp','Hi-res USB DAC amp',4,10,199.99,249.99,99.99,0.350,1,0);

-- ── Product Images ─────────────────────────────────────────

INSERT INTO product_images (product_id, url, alt_text, sort_order, is_primary)
SELECT id, CONCAT('/images/products/', slug, '-1.jpg'), CONCAT(name, ' - Main'), 0, 1 FROM products;

INSERT INTO product_images (product_id, url, alt_text, sort_order, is_primary)
SELECT id, CONCAT('/images/products/', slug, '-2.jpg'), CONCAT(name, ' - Side'), 1, 0 FROM products;

-- ── Inventory ──────────────────────────────────────────────

INSERT INTO inventory (product_id, quantity, reserved, reorder_level, reorder_quantity, warehouse_location, last_restocked_at)
SELECT id,
  FLOOR(20 + RAND() * 480),
  FLOOR(RAND() * 15),
  CASE WHEN price > 500 THEN 5 ELSE 10 END,
  CASE WHEN price > 500 THEN 20 ELSE 50 END,
  CONCAT(CHAR(65 + FLOOR(RAND() * 4)), '-', LPAD(FLOOR(RAND() * 99) + 1, 2, '0')),
  DATE_SUB(NOW(), INTERVAL FLOOR(RAND() * 60) DAY)
FROM products;

-- Set some products to low stock for interesting queries
UPDATE inventory SET quantity = FLOOR(RAND()*8), reserved = 0 WHERE product_id IN (8, 19, 36, 55, 71, 90, 104, 113, 122, 144);

-- ── Coupons ────────────────────────────────────────────────

INSERT INTO coupons (code, description, discount_type, discount_value, min_order_amount, max_uses, times_used, starts_at, expires_at) VALUES
('WELCOME10','New customer 10% off','percentage',10.00,25.00,NULL,1847,'2024-01-01','2026-12-31'),
('SAVE20','Save $20 on $100+','fixed',20.00,100.00,5000,3210,'2024-06-01','2026-06-30'),
('SUMMER25','Summer sale 25% off','percentage',25.00,50.00,2000,1456,'2025-06-01','2025-09-30'),
('TECH15','15% off electronics','percentage',15.00,75.00,1000,487,'2025-01-01','2026-03-31'),
('FREESHIP','Free shipping over $50','fixed',9.99,50.00,NULL,5632,'2024-01-01','2026-12-31'),
('FLASH30','Flash sale 30% off','percentage',30.00,100.00,500,498,'2025-11-01','2025-11-30'),
('HOLIDAY20','Holiday 20% off everything','percentage',20.00,0,3000,2891,'2025-12-01','2026-01-15'),
('NEWYEAR15','New Year 15% off','percentage',15.00,30.00,2000,1100,'2026-01-01','2026-01-31'),
('SPRING10','Spring collection 10% off','percentage',10.00,40.00,1500,302,'2026-03-01','2026-05-31'),
('VIP50','VIP exclusive $50 off','fixed',50.00,200.00,200,89,'2025-01-01','2026-12-31');

-- ══════════════════════════════════════════════════════════════
-- ORDERS (2000) — Procedurally generated
-- ══════════════════════════════════════════════════════════════

-- Create a stored procedure to batch insert orders
DELIMITER //

CREATE PROCEDURE seed_orders()
BEGIN
  DECLARE i INT DEFAULT 1;
  DECLARE v_customer INT;
  DECLARE v_addr INT;
  DECLARE v_status VARCHAR(20);
  DECLARE v_subtotal DECIMAL(10,2);
  DECLARE v_disc DECIMAL(10,2);
  DECLARE v_ship DECIMAL(10,2);
  DECLARE v_tax DECIMAL(10,2);
  DECLARE v_total DECIMAL(10,2);
  DECLARE v_ordered_at DATETIME;
  DECLARE v_order_id INT;
  DECLARE v_coupon INT;
  DECLARE j INT;
  DECLARE v_prod INT;
  DECLARE v_qty INT;
  DECLARE v_unit_price DECIMAL(10,2);
  DECLARE v_num_items INT;
  DECLARE v_rand FLOAT;

  WHILE i <= 2000 DO
    SET v_customer = 1 + FLOOR(RAND() * 200);
    SET v_ordered_at = DATE_SUB(NOW(), INTERVAL FLOOR(RAND() * 730) DAY) + INTERVAL FLOOR(RAND() * 86400) SECOND;
    SET v_rand = RAND();

    IF v_rand < 0.02 THEN SET v_status = 'cancelled';
    ELSEIF v_rand < 0.04 THEN SET v_status = 'refunded';
    ELSEIF v_rand < 0.12 THEN SET v_status = 'pending';
    ELSEIF v_rand < 0.25 THEN SET v_status = 'processing';
    ELSEIF v_rand < 0.45 THEN SET v_status = 'shipped';
    ELSE SET v_status = 'delivered';
    END IF;

    SET v_subtotal = 0;
    SET v_disc = IF(RAND() < 0.25, ROUND(RAND() * 30 + 5, 2), 0);
    SET v_ship = IF(RAND() < 0.3, 0, ROUND(5.99 + RAND() * 9, 2));
    SET v_coupon = IF(RAND() < 0.2, 1 + FLOOR(RAND() * 10), NULL);

    -- Select a random address for this customer
    SELECT id INTO v_addr FROM addresses WHERE customer_id = v_customer ORDER BY is_default DESC LIMIT 1;

    INSERT INTO orders (order_number, customer_id, shipping_address_id, billing_address_id, coupon_id, status, subtotal, discount_amount, shipping_cost, tax_amount, total, ordered_at, shipped_at, delivered_at)
    VALUES (
      CONCAT('ORD-', LPAD(i, 6, '0')),
      v_customer, v_addr, v_addr, v_coupon,
      v_status, 0, v_disc, v_ship, 0, 0,
      v_ordered_at,
      IF(v_status IN ('shipped','delivered'), DATE_ADD(v_ordered_at, INTERVAL 1+FLOOR(RAND()*3) DAY), NULL),
      IF(v_status = 'delivered', DATE_ADD(v_ordered_at, INTERVAL 3+FLOOR(RAND()*7) DAY), NULL)
    );
    SET v_order_id = LAST_INSERT_ID();

    -- Add 1-5 items per order
    SET v_num_items = 1 + FLOOR(RAND() * 5);
    SET j = 1;
    WHILE j <= v_num_items DO
      SET v_prod = 1 + FLOOR(RAND() * 150);
      SET v_qty = 1 + FLOOR(RAND() * 3);
      SELECT price INTO v_unit_price FROM products WHERE id = v_prod;

      INSERT IGNORE INTO order_items (order_id, product_id, quantity, unit_price, total_price)
      VALUES (v_order_id, v_prod, v_qty, v_unit_price, v_unit_price * v_qty);

      SET v_subtotal = v_subtotal + (v_unit_price * v_qty);
      SET j = j + 1;
    END WHILE;

    SET v_tax = ROUND(v_subtotal * 0.08, 2);
    SET v_total = v_subtotal - v_disc + v_ship + v_tax;
    IF v_total < 0 THEN SET v_total = v_subtotal + v_ship + v_tax; SET v_disc = 0; END IF;

    UPDATE orders SET subtotal = v_subtotal, tax_amount = v_tax, total = v_total, discount_amount = v_disc WHERE id = v_order_id;

    SET i = i + 1;
  END WHILE;
END //

DELIMITER ;

CALL seed_orders();
DROP PROCEDURE IF EXISTS seed_orders;

-- ══════════════════════════════════════════════════════════════
-- PAYMENTS — One per order
-- ══════════════════════════════════════════════════════════════

INSERT INTO payments (order_id, method, status, amount, transaction_id, paid_at)
SELECT
  o.id,
  ELT(1+FLOOR(RAND()*5),'credit_card','credit_card','credit_card','debit_card','paypal'),
  CASE
    WHEN o.status IN ('cancelled') THEN 'failed'
    WHEN o.status IN ('refunded') THEN 'refunded'
    WHEN o.status = 'pending' THEN 'pending'
    ELSE 'completed'
  END,
  o.total,
  CONCAT('TXN-', UPPER(SUBSTR(UUID(), 1, 16))),
  CASE WHEN o.status NOT IN ('pending','cancelled') THEN o.ordered_at ELSE NULL END
FROM orders o;

-- ══════════════════════════════════════════════════════════════
-- SHIPMENTS — For non-pending, non-cancelled orders  
-- ══════════════════════════════════════════════════════════════

INSERT INTO shipments (order_id, carrier, tracking_number, status, estimated_delivery, actual_delivery, shipping_cost)
SELECT
  o.id,
  ELT(1+FLOOR(RAND()*4),'FedEx','UPS','USPS','DHL'),
  CONCAT(ELT(1+FLOOR(RAND()*4),'FX','1Z','94','DHL'), UPPER(SUBSTR(UUID(), 1, 18))),
  CASE
    WHEN o.status = 'delivered' THEN 'delivered'
    WHEN o.status = 'shipped' THEN ELT(1+FLOOR(RAND()*2),'in_transit','out_for_delivery')
    WHEN o.status = 'refunded' THEN 'returned'
    ELSE 'label_created'
  END,
  DATE_ADD(o.ordered_at, INTERVAL 5+FLOOR(RAND()*5) DAY),
  IF(o.status = 'delivered', o.delivered_at, NULL),
  o.shipping_cost
FROM orders o
WHERE o.status NOT IN ('pending','cancelled');

-- ══════════════════════════════════════════════════════════════
-- REVIEWS (1500) 
-- ══════════════════════════════════════════════════════════════

DELIMITER //
CREATE PROCEDURE seed_reviews()
BEGIN
  DECLARE i INT DEFAULT 1;
  DECLARE v_prod INT;
  DECLARE v_cust INT;
  DECLARE v_rating INT;
  DECLARE v_titles TEXT;
  DECLARE v_title VARCHAR(150);

  WHILE i <= 1500 DO
    SET v_prod = 1 + FLOOR(RAND() * 150);
    SET v_cust = 1 + FLOOR(RAND() * 200);
    SET v_rating = CASE
      WHEN RAND() < 0.05 THEN 1
      WHEN RAND() < 0.15 THEN 2
      WHEN RAND() < 0.35 THEN 3
      WHEN RAND() < 0.65 THEN 4
      ELSE 5
    END;

    SET v_title = ELT(1+FLOOR(RAND()*15),
      'Great product!','Exceeded expectations','Good value for money',
      'Not what I expected','Amazing quality','Perfect gift',
      'Highly recommend','Decent but could improve','Love it!',
      'Best purchase ever','Works as described','Disappointed',
      'Solid build quality','Fast shipping','Would buy again');

    INSERT IGNORE INTO reviews (product_id, customer_id, rating, title, body, is_verified_purchase, helpful_count, created_at)
    VALUES (
      v_prod, v_cust, v_rating, v_title,
      ELT(1+FLOOR(RAND()*10),
        'Very satisfied with this purchase. Works exactly as described and arrived quickly.',
        'The quality is outstanding. I have been using it daily and it holds up great.',
        'Good product overall but packaging could be better. Would still recommend.',
        'Not quite what I expected from the photos. Average quality for the price.',
        'Absolutely love this! Already ordered another one as a gift.',
        'Decent product. Nothing special but gets the job done for the price.',
        'Premium feel and excellent build quality. Worth every penny spent.',
        'Had some issues initially but customer service was very helpful.',
        'This is exactly what I was looking for. Five stars all the way!',
        'Okay product, slightly overpriced compared to alternatives on the market.'),
      IF(RAND() < 0.7, 1, 0),
      FLOOR(RAND() * 50),
      DATE_SUB(NOW(), INTERVAL FLOOR(RAND() * 365) DAY)
    );

    SET i = i + 1;
  END WHILE;
END //
DELIMITER ;

CALL seed_reviews();
DROP PROCEDURE IF EXISTS seed_reviews;

-- ══════════════════════════════════════════════════════════════
-- WISHLISTS (500)
-- ══════════════════════════════════════════════════════════════

DELIMITER //
CREATE PROCEDURE seed_wishlists()
BEGIN
  DECLARE i INT DEFAULT 1;
  WHILE i <= 500 DO
    INSERT IGNORE INTO wishlists (customer_id, product_id, added_at)
    VALUES (
      1 + FLOOR(RAND() * 200),
      1 + FLOOR(RAND() * 150),
      DATE_SUB(NOW(), INTERVAL FLOOR(RAND() * 180) DAY)
    );
    SET i = i + 1;
  END WHILE;
END //
DELIMITER ;

CALL seed_wishlists();
DROP PROCEDURE IF EXISTS seed_wishlists;

-- ══════════════════════════════════════════════════════════════
-- CART ITEMS (150) — Active carts
-- ══════════════════════════════════════════════════════════════

DELIMITER //
CREATE PROCEDURE seed_carts()
BEGIN
  DECLARE i INT DEFAULT 1;
  WHILE i <= 150 DO
    INSERT IGNORE INTO cart_items (customer_id, product_id, quantity, added_at)
    VALUES (
      1 + FLOOR(RAND() * 200),
      1 + FLOOR(RAND() * 150),
      1 + FLOOR(RAND() * 3),
      DATE_SUB(NOW(), INTERVAL FLOOR(RAND() * 14) DAY)
    );
    SET i = i + 1;
  END WHILE;
END //
DELIMITER ;

CALL seed_carts();
DROP PROCEDURE IF EXISTS seed_carts;

-- ══════════════════════════════════════════════════════════════
-- Final summary
-- ══════════════════════════════════════════════════════════════

SELECT 'SEED COMPLETE' AS status,
  (SELECT COUNT(*) FROM customers) AS customers,
  (SELECT COUNT(*) FROM products) AS products,
  (SELECT COUNT(*) FROM orders) AS orders,
  (SELECT COUNT(*) FROM order_items) AS order_items,
  (SELECT COUNT(*) FROM reviews) AS reviews,
  (SELECT COUNT(*) FROM payments) AS payments,
  (SELECT COUNT(*) FROM shipments) AS shipments;
