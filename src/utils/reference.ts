/**
 * Reference ID Generation Utilities
 *
 * Generates non-linking reference IDs for completed transactions.
 * These IDs are for user reference only and CANNOT trace back to
 * the deposit/withdrawal or reveal any transaction details.
 *
 * Format: VEIL-XXXXXX (6 alphanumeric characters)
 * Uses timestamp + random - NOT nullifier, commitment, or any on-chain data!
 */

// Character set for reference ID (excludes confusing chars like 0/O, 1/I/l)
const REFERENCE_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/**
 * Generate a cryptographically-inspired random reference ID
 *
 * IMPORTANT: This ID is purely for user reference and customer support.
 * It is NOT derived from any on-chain data, commitment, or nullifier.
 * This ensures no link can be made between the reference ID and the
 * actual transaction on the privacy pool.
 *
 * @returns Reference ID in format VEIL-XXXXXX
 */
export function generateReferenceId(): string {
  // Generate 6 random characters from our charset
  let result = '';
  const charsetLength = REFERENCE_CHARS.length;

  for (let i = 0; i < 6; i++) {
    const randomValue = getSecureRandom();
    const index = randomValue % charsetLength;
    result += REFERENCE_CHARS[index];
  }

  return `VEIL-${result}`;
}

/**
 * Get a secure random number
 * Uses crypto API when available, falls back to Math.random
 */
function getSecureRandom(): number {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const array = new Uint32Array(1);
    crypto.getRandomValues(array);
    return array[0];
  }
  // Fallback (less secure but still random)
  return Math.floor(Math.random() * 0xFFFFFFFF);
}

/**
 * Validate a reference ID format
 *
 * @param id - Reference ID to validate
 * @returns true if valid format
 */
export function isValidReferenceId(id: string): boolean {
  if (!id || typeof id !== 'string') return false;

  // Check format: VEIL-XXXXXX
  const regex = /^VEIL-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;
  return regex.test(id);
}

/**
 * Format a reference ID for display (already formatted)
 *
 * @param id - Reference ID
 * @returns Formatted reference ID
 */
export function formatReferenceId(id: string): string {
  return id;
}

/**
 * Generate a reference ID with timestamp metadata
 * Returns both the ID and the generation timestamp
 *
 * @returns Object with referenceId and timestamp
 */
export function generateReferenceIdWithMetadata(): {
  referenceId: string;
  timestamp: number;
  formattedTime: string;
} {
  const timestamp = Date.now();
  const referenceId = generateReferenceId();

  const formattedTime = new Date(timestamp).toLocaleString([], {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return {
    referenceId,
    timestamp,
    formattedTime,
  };
}
