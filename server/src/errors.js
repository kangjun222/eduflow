// HTTP 상태 코드를 함께 갖는 애플리케이션 에러.
// 라우터에서 상태 코드를 일일이 정하지 않고 서비스 계층에서 의미를 정한다.
class AppError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const badRequest = (message, details) => new AppError(400, 'BAD_REQUEST', message, details);
const notFound = (message) => new AppError(404, 'NOT_FOUND', message);
const conflict = (message, details) => new AppError(409, 'CONFLICT', message, details);

module.exports = { AppError, badRequest, notFound, conflict };
