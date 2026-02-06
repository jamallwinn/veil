//! Tauri Commands for Secure Storage
//!
//! Provides secure keychain storage using the OS native credential manager:
//! - macOS: Keychain
//! - Windows: Credential Manager
//! - Linux: Secret Service (libsecret)

use keyring::Entry;

/// Service name for the keyring
const SERVICE_NAME: &str = "veil-app";

/// Store a secret in the OS keychain
///
/// # Arguments
/// * `key` - The key/account name for the secret
/// * `value` - The secret value to store
///
/// # Returns
/// * `Ok(())` on success
/// * `Err(String)` with error message on failure
#[tauri::command]
pub fn store_secret(key: String, value: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, &key).map_err(|e| format!("Failed to create keyring entry: {}", e))?;

    entry
        .set_password(&value)
        .map_err(|e| format!("Failed to store secret: {}", e))
}

/// Retrieve a secret from the OS keychain
///
/// # Arguments
/// * `key` - The key/account name for the secret
///
/// # Returns
/// * `Ok(Some(String))` if secret exists
/// * `Ok(None)` if secret does not exist
/// * `Err(String)` with error message on failure
#[tauri::command]
pub fn get_secret(key: String) -> Result<Option<String>, String> {
    let entry = Entry::new(SERVICE_NAME, &key).map_err(|e| format!("Failed to create keyring entry: {}", e))?;

    match entry.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Failed to retrieve secret: {}", e)),
    }
}

/// Delete a secret from the OS keychain
///
/// # Arguments
/// * `key` - The key/account name for the secret to delete
///
/// # Returns
/// * `Ok(())` on success (including if secret didn't exist)
/// * `Err(String)` with error message on failure
#[tauri::command]
pub fn delete_secret(key: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, &key).map_err(|e| format!("Failed to create keyring entry: {}", e))?;

    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()), // Already deleted, treat as success
        Err(e) => Err(format!("Failed to delete secret: {}", e)),
    }
}

/// Check if a secret exists in the OS keychain
///
/// # Arguments
/// * `key` - The key/account name to check
///
/// # Returns
/// * `Ok(true)` if secret exists
/// * `Ok(false)` if secret does not exist
/// * `Err(String)` with error message on failure
#[tauri::command]
pub fn has_secret(key: String) -> Result<bool, String> {
    let entry = Entry::new(SERVICE_NAME, &key).map_err(|e| format!("Failed to create keyring entry: {}", e))?;

    match entry.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(format!("Failed to check secret: {}", e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_store_and_get_secret() {
        let test_key = "test_key_unit_test";
        let test_value = "test_secret_value";

        // Clean up any existing entry
        let _ = delete_secret(test_key.to_string());

        // Store secret
        let store_result = store_secret(test_key.to_string(), test_value.to_string());
        assert!(store_result.is_ok(), "Failed to store secret: {:?}", store_result);

        // Get secret
        let get_result = get_secret(test_key.to_string());
        assert!(get_result.is_ok(), "Failed to get secret: {:?}", get_result);
        assert_eq!(get_result.unwrap(), Some(test_value.to_string()));

        // Clean up
        let _ = delete_secret(test_key.to_string());
    }

    #[test]
    fn test_get_nonexistent_secret() {
        let test_key = "nonexistent_key_12345";

        // Ensure it doesn't exist
        let _ = delete_secret(test_key.to_string());

        let result = get_secret(test_key.to_string());
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), None);
    }

    #[test]
    fn test_delete_secret() {
        let test_key = "test_key_delete";
        let test_value = "test_value";

        // Store a secret first
        let _ = store_secret(test_key.to_string(), test_value.to_string());

        // Delete it
        let delete_result = delete_secret(test_key.to_string());
        assert!(delete_result.is_ok());

        // Verify it's gone
        let get_result = get_secret(test_key.to_string());
        assert_eq!(get_result.unwrap(), None);
    }

    #[test]
    fn test_has_secret() {
        let test_key = "test_key_has";
        let test_value = "test_value";

        // Clean up first
        let _ = delete_secret(test_key.to_string());

        // Should not exist
        assert_eq!(has_secret(test_key.to_string()).unwrap(), false);

        // Store it
        let _ = store_secret(test_key.to_string(), test_value.to_string());

        // Should exist now
        assert_eq!(has_secret(test_key.to_string()).unwrap(), true);

        // Clean up
        let _ = delete_secret(test_key.to_string());
    }

    #[test]
    fn test_delete_nonexistent_secret() {
        let test_key = "nonexistent_key_to_delete";

        // Ensure it doesn't exist
        let _ = delete_secret(test_key.to_string());

        // Deleting a non-existent secret should succeed
        let result = delete_secret(test_key.to_string());
        assert!(result.is_ok());
    }
}
