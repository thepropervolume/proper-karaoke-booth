-- Apply as the database administrator to the dedicated tpv_booth_accounts schema.
-- The account runtime receives SELECT, INSERT, UPDATE and DELETE only.
CREATE TABLE IF NOT EXISTS booth_accounts (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(254) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
    name VARCHAR(60) NOT NULL,
    password_hash VARCHAR(164) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS booth_account_links (
    token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    email VARCHAR(254) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    kind ENUM('register','signin','reset') NOT NULL,
    name VARCHAR(60),
    password_hash VARCHAR(164) CHARACTER SET ascii COLLATE ascii_bin,
    account_id INT UNSIGNED,
    expires_at BIGINT UNSIGNED NOT NULL,
    INDEX booth_link_expiry (expires_at),
    INDEX booth_link_email (email),
    FOREIGN KEY (account_id) REFERENCES booth_accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS booth_account_sessions (
    token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    account_id INT UNSIGNED NOT NULL,
    expires_at BIGINT UNSIGNED NOT NULL,
    INDEX booth_session_expiry (expires_at),
    FOREIGN KEY (account_id) REFERENCES booth_accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4;-- Optional profile fields are owner-scoped and removed with the account.
CREATE TABLE IF NOT EXISTS booth_account_profiles (
    account_id INT UNSIGNED NOT NULL PRIMARY KEY,
    pronouns VARCHAR(32) NOT NULL,
    bio VARCHAR(160) NOT NULL,
    avatar MEDIUMTEXT CHARACTER SET ascii COLLATE ascii_bin,
    FOREIGN KEY (account_id) REFERENCES booth_accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4;
