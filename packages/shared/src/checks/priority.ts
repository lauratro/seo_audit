/**
 * Remediation priority. Values only: how a priority is derived (severity,
 * SEO impact, effort) is decided in a later task.
 */
export const PRIORITIES = ['high', 'medium', 'low'] as const;

export type Priority = (typeof PRIORITIES)[number];
