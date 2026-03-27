/**
 * Vietnamese translations for Dashboard
 */
export default {
  // Navigation
  nav: {
    licenses: 'Quản Lý License',
    audit: 'Audit Logs',
    analytics: 'Analytics',
  },

  // License Page
  license: {
    title: 'Quản Lý License',
    subtitle: 'Quản lý RaaS licenses và xem usage analytics',
    create: 'Tạo License',
    activate: 'Kích Hoạt License',
  },

  // License List Table
  'license-list': {
    name: 'Tên',
    key: 'Key',
    domain: 'Domain',
    tier: 'Tier',
    status: 'Trạng Thái',
    usage: 'Sử Dụng',
    created: 'Đã Tạo',
    expires: 'Hết Hạn',
    actions: 'Hành Động',
    loading: 'Đang tải licenses...',
    noLicenses: 'Không có licenses nào',
    noLicensesMatch: 'Không có licenses nào phù hợp với bộ lọc',
    clearFilters: 'Xóa bộ lọc',
    showing: 'Hiển thị',
    of: 'trên',
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
    status: 'Trạng Thái',
    tier: 'Tier',
    all: 'Tất Cả',
  },

  // Actions
  actions: {
    revoke: 'Thu Hồi License',
    delete: 'Xóa License',
    viewAudit: 'Xem Audit Log',
    confirmDelete: 'Xóa license "{{name}}"? Hành động này không thể hoàn tác.',
  },

  // Create License Modal
  'create-license': {
    title: 'Tạo License Mới',
    successTitle: 'Đã Tạo License',
    nameLabel: 'Tên License',
    namePlaceholder: 'ví dụ: Production License 001',
    tierLabel: 'Tier',
    tierDescription: 'Mô tả',
    expirationLabel: 'Ngày Hết Hạn',
    expirationHint: 'Để trống cho license không thời hạn',
    tenantLabel: 'Tenant ID',
    tenantPlaceholder: 'ví dụ: tenant_abc123',
    tenantHint: 'Ràng buộc license cho tenant cụ thể',
    generateButton: 'Tạo License',
    generating: 'Đang tạo...',
    cancelButton: 'Hủy',
    closeButton: 'Đóng',
    successMessage: 'License key đã được tạo!',
    storeKeyHint: 'Lưu trữ key này cẩn thận. Sẽ không hiển thị lại.',
    licenseKeyLabel: 'License Key',
    copy: 'Sao Chép',
    copied: 'Đã Sao Chép',
  },

  // Activate License Modal
  'activate-license': {
    title: 'Kích Hoạt License',
    keyLabel: 'License Key',
    keyPlaceholder: 'Nhập license key của bạn',
    activateButton: 'Kích Hoạt',
    activating: 'Đang kích hoạt...',
    successMessage: 'Đã kích hoạt license thành công!',
  },

  // Success/Error Messages
  messages: {
    licenseGenerated: 'License key đã được tạo: {{key}}',
    licenseActivated: 'Đã kích hoạt license: {{tier}}{{domain, withDomain}}',
    licenseRevoked: 'License đã được thu hồi',
    licenseDeleted: 'License đã được xóa',
    error: 'Lỗi: {{error}}',
  },

  // Common
  common: {
    loading: 'Đang tải...',
    saving: 'Đang lưu...',
    cancel: 'Hủy',
    close: 'Đóng',
    confirm: 'Xác Nhận',
    delete: 'Xóa',
    save: 'Lưu',
    edit: 'Sửa',
    view: 'Xem',
    never: 'Không bao giờ',
  },
} as const;
