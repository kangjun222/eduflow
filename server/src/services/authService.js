const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { sql, getPool } = require('../db');
const { badRequest, unauthorized } = require('../errors');

const TOKEN_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? '2h';

// 존재하지 않는 이메일과 틀린 비밀번호를 같은 메시지로 답한다.
// 메시지를 구분하면 "이 이메일은 가입돼 있다"는 사실이 노출되어
// 공격자가 유효한 계정 목록을 수집할 수 있다.
const LOGIN_FAILED = '이메일 또는 비밀번호가 올바르지 않습니다.';

// 비밀번호가 없는 계정(시드 자리표시자 등)과 비교할 때 쓰는 더미 해시.
// 비교를 건너뛰면 응답이 눈에 띄게 빨라져, 그 시간 차이만으로
// 계정 존재 여부를 알아낼 수 있다. 형식이 유효해야 bcrypt 가 실제로 계산한다.
const DUMMY_HASH = '$2b$10$CwTycUXWue0Thq9StjUM0uJ8DFiTIkR/2Xz0Q1p8kAqz1sJ5nZ0Ke';

function getSecret() {
  const secret = process.env.JWT_SECRET;
  // 비밀 키가 없을 때 임의의 기본값으로 넘어가면
  // 누구나 토큰을 위조할 수 있는 서버가 조용히 떠버린다.
  if (!secret) {
    throw new Error('JWT_SECRET 환경변수가 설정되지 않았습니다. server/.env 를 확인하세요.');
  }
  return secret;
}

// 토큰에는 식별에 필요한 최소한만 담는다.
// 이름이나 이메일까지 넣으면 값이 바뀌어도 토큰이 만료될 때까지 옛 값이 돌아다닌다.
function signToken(user) {
  return jwt.sign({ sub: String(user.id), role: user.role }, getSecret(), {
    expiresIn: TOKEN_EXPIRES_IN,
  });
}

// 검증 실패(위조·만료·형식 오류)는 전부 401 로 묶는다.
// 어떤 이유로 실패했는지 알려주면 토큰을 다듬어가며 시도할 여지를 준다.
function verifyToken(token) {
  try {
    return jwt.verify(token, getSecret());
  } catch {
    throw unauthorized('로그인이 필요합니다.');
  }
}

async function findByEmail(email) {
  const pool = await getPool();
  const { recordset } = await pool
    .request()
    .input('email', sql.NVarChar(255), email)
    .query(`
      SELECT id, email, password_hash, name, role, status
        FROM users
       WHERE email = @email;
    `);
  return recordset[0];
}

async function findById(id) {
  const pool = await getPool();
  const { recordset } = await pool
    .request()
    .input('id', sql.Int, id)
    .query(`
      SELECT id, email, name, role, status
        FROM users
       WHERE id = @id;
    `);
  return recordset[0];
}

// 클라이언트로 내보내는 형태. password_hash 가 섞여 나가지 않도록 여기서만 만든다.
function toPublicUser(user) {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

async function login({ email, password }) {
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    throw badRequest('email 과 password 가 필요합니다.');
  }

  const user = await findByEmail(email.trim().toLowerCase());
  const matched = await bcrypt.compare(password, user?.password_hash || DUMMY_HASH);

  if (!user || !matched) {
    throw unauthorized(LOGIN_FAILED);
  }

  // 퇴원·퇴사한 계정은 비밀번호가 맞아도 들여보내지 않는다.
  // 이 경우는 계정 존재가 이미 확인된 뒤라 사유를 알려줘도 새로 새는 정보가 없다.
  if (user.status !== 'active') {
    throw unauthorized('비활성화된 계정입니다. 관리자에게 문의하세요.');
  }

  return { token: signToken(user), user: toPublicUser(user) };
}

// 토큰의 sub 로 사용자를 다시 읽는다.
// 토큰 발급 이후 삭제되거나 비활성화된 계정을 걸러내려면 매 요청 확인이 필요하다.
async function getActiveUser(id) {
  const user = await findById(Number(id));
  if (!user || user.status !== 'active') {
    throw unauthorized('로그인이 필요합니다.');
  }
  return toPublicUser(user);
}

module.exports = { login, signToken, verifyToken, getActiveUser, toPublicUser, TOKEN_EXPIRES_IN };
