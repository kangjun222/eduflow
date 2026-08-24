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
// 401 은 "누구인지 모른다", 403 은 "누구인지 알지만 권한이 없다" 이다.
// 둘을 섞으면 클라이언트가 로그인 화면으로 보낼지 말지 판단할 수 없다.
const unauthorized = (message) => new AppError(401, 'UNAUTHORIZED', message);
const forbidden = (message) => new AppError(403, 'FORBIDDEN', message);
const notFound = (message) => new AppError(404, 'NOT_FOUND', message);
const conflict = (message, details) => new AppError(409, 'CONFLICT', message, details);

module.exports = { AppError, badRequest, unauthorized, forbidden, notFound, conflict };
