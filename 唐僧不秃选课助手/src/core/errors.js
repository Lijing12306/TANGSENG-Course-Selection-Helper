export class AppError extends Error {
  constructor(message, code = 'APP_ERROR', detail = null) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.detail = detail;
  }
}

export class ConfigError extends AppError {
  constructor(message, detail) { super(message, 'CONFIG_ERROR', detail); }
}

export class NetworkError extends AppError {
  constructor(message, detail) { super(message, 'NETWORK_ERROR', detail); }
}

export class AuthError extends AppError {
  constructor(message, detail) { super(message, 'AUTH_ERROR', detail); }
}

export class CaptchaRequiredError extends AuthError {
  constructor(message = '需要输入验证码，已停止自动登录', detail) {
    super(message, detail);
    this.code = 'CAPTCHA_REQUIRED';
  }
}

export class CasRequiredError extends AuthError {
  constructor(message = '站点强制走统一身份认证(CAS)，请改用手动 Cookie 模式', detail) {
    super(message, detail);
    this.code = 'CAS_REQUIRED';
  }
}

export class SessionExpiredError extends AppError {
  constructor(message = '会话已失效', detail) { super(message, 'SESSION_EXPIRED', detail); }
}

export class NotCalibratedError extends AppError {
  constructor(message = '选课接口尚未校准，请先完成【抓包导入】', detail) {
    super(message, 'NOT_CALIBRATED', detail);
  }
}

export class PlaceholderError extends AppError {
  constructor(name, actionName) {
    super(`动作 [${actionName}] 的占位符 {${name}} 未提供值，已阻止请求以避免提交错误参数`, 'PLACEHOLDER_MISSING', { name, actionName });
  }
}

export class RateLimitError extends AppError {
  constructor(message, cooldownMs = 0) { super(message, 'RATE_LIMIT', { cooldownMs }); }
}
