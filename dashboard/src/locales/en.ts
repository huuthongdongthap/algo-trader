/**
 * English translations for Dashboard
 */
export default {
  // Navigation
  nav: {
    licenses: 'License Management',
    audit: 'Audit Logs',
    analytics: 'Analytics',
  },

  // License Page
  license: {
    title: 'License Management',
    subtitle: 'Manage RaaS licenses and view usage analytics',
    create: 'Create License',
    activate: 'Activate License',
  },

  // License List Table
  'license-list': {
    name: 'Name',
    key: 'Key',
    domain: 'Domain',
    tier: 'Tier',
    status: 'Status',
    usage: 'Usage',
    created: 'Created',
    expires: 'Expires',
    actions: 'Actions',
    loading: 'Loading licenses...',
    noLicenses: 'No licenses',
    noLicensesMatch: 'No licenses match the current filters',
    clearFilters: 'Clear filters',
    showing: 'Showing',
    of: 'of',
    licenses: 'licenses',
  },

  // License Tiers
  tier: {
    free: 'FREE',
    pro: 'PRO',
    enterprise: 'ENTERPRISE',
  },

  // License Status
  status: {
    active: 'ACTIVE',
    expired: 'EXPIRED',
    revoked: 'REVOKED',
  },

  // Filters
  filters: {
    status: 'Status',
    tier: 'Tier',
    all: 'All',
  },

  // Actions
  actions: {
    revoke: 'Revoke License',
    delete: 'Delete License',
    viewAudit: 'View Audit Log',
    confirmDelete: 'Delete license "{{name}}"? This cannot be undone.',
  },

  // Create License Modal
  'create-license': {
    title: 'Create New License',
    successTitle: 'License Generated',
    nameLabel: 'License Name',
    namePlaceholder: 'e.g., Production License 001',
    tierLabel: 'Tier',
    tierDescription: 'Description',
    expirationLabel: 'Expiration Date',
    expirationHint: 'Leave empty for non-expiring license',
    tenantLabel: 'Tenant ID',
    tenantPlaceholder: 'e.g., tenant_abc123',
    tenantHint: 'Bind license to specific tenant',
    generateButton: 'Generate License',
    generating: 'Generating...',
    cancelButton: 'Cancel',
    closeButton: 'Close',
    successMessage: 'License key generated successfully!',
    storeKeyHint: 'Store this key securely. It won\'t be shown again.',
    licenseKeyLabel: 'License Key',
    copy: 'Copy',
    copied: 'Copied',
  },

  // Activate License Modal
  'activate-license': {
    title: 'Activate License',
    keyLabel: 'License Key',
    keyPlaceholder: 'Enter your license key',
    activateButton: 'Activate',
    activating: 'Activating...',
    successMessage: 'License activated successfully!',
  },

  // Success/Error Messages
  messages: {
    licenseGenerated: 'License key generated: {{key}}',
    licenseActivated: 'License activated: {{tier}}{{domain, withDomain}}',
    licenseRevoked: 'License revoked',
    licenseDeleted: 'License deleted',
    error: 'Error: {{error}}',
  },

  // Common
  common: {
    loading: 'Loading...',
    saving: 'Saving...',
    cancel: 'Cancel',
    close: 'Close',
    confirm: 'Confirm',
    delete: 'Delete',
    save: 'Save',
    edit: 'Edit',
    view: 'View',
    never: 'Never',
  },
} as const;
