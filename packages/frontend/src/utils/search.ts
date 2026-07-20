/** Strip diacritics and lowercase for accent-insensitive search */
export function normalize_search(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}
