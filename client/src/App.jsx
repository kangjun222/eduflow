import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from './auth.jsx';
import Login from './Login.jsx';
import './App.css';

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
const HOUR_START = 9;
const HOUR_END = 22;
const ROW_HEIGHT = 44; // 1시간당 픽셀

// 강좌마다 다른 색을 주되, 같은 강좌는 항상 같은 색이 되도록 id 기반으로 고른다.
const PALETTE = ['#4f7cff', '#00a37a', '#e8590c', '#9333ea', '#0891b2', '#c2255c'];
const colorOf = (courseId) => PALETTE[courseId % PALETTE.length];

const ROLE_LABEL = { admin: '관리자', teacher: '강사', student: '학생' };

function toDateInput(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function startOfWeek(date) {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay()); // 일요일 기준
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

// 로그인하지 않았으면 어떤 화면도 보여주지 않는다.
// 화면을 가리는 것만으로는 보호가 되지 않으므로 API 쪽에도 같은 검사가 걸려 있다.
export default function App() {
  const { user, checking } = useAuth();

  if (checking) return <p className="muted center-note">확인 중…</p>;
  if (!user) return <Login />;
  return <Timetable user={user} />;
}

function Timetable({ user }) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date('2026-09-01')));
  const [lessons, setLessons] = useState([]);
  const [meta, setMeta] = useState({ teachers: [], rooms: [], students: [] });
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [myEnrollments, setMyEnrollments] = useState([]);
  const [enrollError, setEnrollError] = useState(null);
  const [busyCourseId, setBusyCourseId] = useState(null);
  const { logout } = useAuth();

  const isStudent = user.role === 'student';

  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);

  const loadTimetable = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/timetable?from=${toDateInput(weekStart)}&to=${toDateInput(weekEnd)}`);
      setLessons(await res.json());
      const c = await fetch('/api/courses');
      setCourses(await c.json());
    } finally {
      setLoading(false);
    }
  }, [weekStart, weekEnd]);

  useEffect(() => {
    fetch('/api/meta').then((r) => r.json()).then(setMeta);
  }, []);

  useEffect(() => {
    loadTimetable();
  }, [loadTimetable]);

  const loadEnrollments = useCallback(async () => {
    if (!isStudent) return;
    const res = await fetch('/api/enrollments/me');
    if (res.ok) setMyEnrollments(await res.json());
  }, [isStudent]);

  useEffect(() => {
    loadEnrollments();
  }, [loadEnrollments]);

  // 신청한 강좌 id 모음. 표에서 버튼 상태를 정하는 데 쓴다.
  const enrolledIds = useMemo(
    () => new Set(myEnrollments.map((e) => e.courseId)),
    [myEnrollments]
  );

  async function toggleEnroll(course) {
    const enrolled = enrolledIds.has(course.id);
    setBusyCourseId(course.id);
    setEnrollError(null);
    try {
      const res = await fetch(
        enrolled ? `/api/enrollments/${course.id}` : '/api/enrollments',
        {
          method: enrolled ? 'DELETE' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: enrolled ? undefined : JSON.stringify({ courseId: course.id }),
        }
      );
      if (!res.ok) {
        const body = await res.json();
        setEnrollError(body.error?.message ?? '요청에 실패했습니다.');
      }
      // 성공이든 실패든 서버 상태를 다시 읽는다.
      // 정원이 찬 경우처럼 남이 바꿔놓은 값이 화면에 반영돼야 한다.
      await Promise.all([loadEnrollments(), loadTimetable()]);
    } catch {
      setEnrollError('서버에 연결할 수 없습니다.');
    } finally {
      setBusyCourseId(null);
    }
  }

  const byDay = useMemo(() => {
    const map = Array.from({ length: 7 }, () => []);
    lessons.forEach((l) => map[l.dayOfWeek]?.push(l));
    return map;
  }, [lessons]);

  const hours = useMemo(
    () => Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i),
    []
  );

  return (
    <div className="app">
      <header className="header">
        <h1>EduFlow</h1>
        <span className="subtitle">학원 수업·예약 관리</span>
        <span className="who">
          {user.name} <span className="role-tag">{ROLE_LABEL[user.role]}</span>
        </span>
        <button className="link-btn" onClick={logout}>로그아웃</button>
      </header>

      <div className="layout">
        {user.role === 'admin' ? (
          <CourseForm meta={meta} onCreated={loadTimetable} />
        ) : (
          <section className="panel form-panel">
            <h2>강좌 개설</h2>
            <p className="muted">관리자만 강좌를 개설할 수 있습니다.</p>
          </section>
        )}

        <section className="panel timetable-panel">
          <div className="panel-head">
            <h2>주간 시간표</h2>
            <div className="week-nav">
              <button onClick={() => setWeekStart(addDays(weekStart, -7))}>◀</button>
              <span className="week-label">
                {toDateInput(weekStart)} ~ {toDateInput(weekEnd)}
              </span>
              <button onClick={() => setWeekStart(addDays(weekStart, 7))}>▶</button>
            </div>
          </div>

          {loading && <p className="muted">불러오는 중…</p>}
          {!loading && lessons.length === 0 && (
            <p className="muted">이 주에는 수업이 없습니다. 왼쪽에서 강좌를 개설해보세요.</p>
          )}

          <div className="grid">
            <div className="time-col">
              <div className="day-head" />
              {hours.map((h) => (
                <div key={h} className="time-cell" style={{ height: ROW_HEIGHT }}>
                  {String(h).padStart(2, '0')}:00
                </div>
              ))}
            </div>

            {DAYS.map((day, idx) => (
              <div key={day} className="day-col">
                <div className="day-head">
                  {day}
                  <span className="day-date">{toDateInput(addDays(weekStart, idx)).slice(5)}</span>
                </div>
                <div
                  className="day-body"
                  style={{ height: (HOUR_END - HOUR_START) * ROW_HEIGHT }}
                >
                  {hours.map((h) => (
                    <div key={h} className="hour-line" style={{ top: (h - HOUR_START) * ROW_HEIGHT }} />
                  ))}
                  {byDay[idx].map((l) => {
                    const top = ((toMinutes(l.startTime) - HOUR_START * 60) / 60) * ROW_HEIGHT;
                    const height = ((toMinutes(l.endTime) - toMinutes(l.startTime)) / 60) * ROW_HEIGHT;
                    return (
                      <div
                        key={l.id}
                        className="lesson"
                        style={{ top, height, background: colorOf(l.courseId) }}
                        title={`${l.courseTitle} / ${l.teacherName} / ${l.roomName}`}
                      >
                        <strong>{l.courseTitle}</strong>
                        <span>{l.teacherName} · {l.roomName}</span>
                        <span className="lesson-time">{l.startTime}~{l.endTime}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="panel">
        <h2>개설된 강좌 ({courses.length})</h2>
        {enrollError && <div className="alert error"><p>{enrollError}</p></div>}
        {courses.length === 0 ? (
          <p className="muted">아직 개설된 강좌가 없습니다.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>강좌</th><th>강사</th><th>강의실</th>
                <th>기간</th><th>회차</th><th>수강</th>
                {isStudent && <th>신청</th>}
              </tr>
            </thead>
            <tbody>
              {courses.map((c) => {
                const enrolled = enrolledIds.has(c.id);
                const full = c.enrolledCount >= c.capacity;
                return (
                  <tr key={c.id}>
                    <td><span className="dot" style={{ background: colorOf(c.id) }} />{c.title}</td>
                    <td>{c.teacherName}</td>
                    <td>{c.roomName}</td>
                    <td className="muted">{c.startDate} ~ {c.endDate}</td>
                    <td>{c.lessonCount}</td>
                    <td className={full ? 'full' : undefined}>{c.enrolledCount} / {c.capacity}</td>
                    {isStudent && (
                      <td>
                        <button
                          className={enrolled ? 'enroll-btn on' : 'enroll-btn'}
                          disabled={busyCourseId === c.id || (!enrolled && full)}
                          onClick={() => toggleEnroll(c)}
                        >
                          {enrolled ? '취소' : full ? '정원 마감' : '신청'}
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function CourseForm({ meta, onCreated }) {
  const [form, setForm] = useState({
    title: '',
    teacherId: '',
    roomId: '',
    capacity: 10,
    startDate: '2026-09-01',
    endDate: '2026-09-30',
    startTime: '19:00',
    endTime: '20:30',
  });
  const [days, setDays] = useState([2]); // 기본: 화요일
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const toggleDay = (d) =>
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch('/api/courses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title,
          teacherId: Number(form.teacherId),
          roomId: Number(form.roomId),
          capacity: Number(form.capacity),
          startDate: form.startDate,
          endDate: form.endDate,
          schedules: days.map((d) => ({
            dayOfWeek: d,
            startTime: form.startTime,
            endTime: form.endTime,
          })),
        }),
      });
      const body = await res.json();

      if (res.ok) {
        setResult({ kind: 'ok', message: `개설 완료 — 수업 회차 ${body.lessonCount}개가 생성됐습니다.` });
        setForm({ ...form, title: '' });
        onCreated();
      } else {
        setResult({ kind: 'error', message: body.error?.message ?? '요청에 실패했습니다.', details: body.error?.details });
      }
    } catch {
      setResult({ kind: 'error', message: '서버에 연결할 수 없습니다.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel form-panel">
      <h2>강좌 개설</h2>
      <form onSubmit={submit}>
        <label>강좌명
          <input value={form.title} onChange={set('title')} placeholder="중등 수학 A반" required />
        </label>

        <div className="row">
          <label>강사
            <select value={form.teacherId} onChange={set('teacherId')} required>
              <option value="">선택</option>
              {meta.teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label>강의실
            <select value={form.roomId} onChange={set('roomId')} required>
              <option value="">선택</option>
              {meta.rooms.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.capacity})</option>)}
            </select>
          </label>
        </div>

        <label>요일
          <div className="days">
            {DAYS.map((d, i) => (
              <button
                type="button"
                key={d}
                className={days.includes(i) ? 'day-btn on' : 'day-btn'}
                onClick={() => toggleDay(i)}
              >{d}</button>
            ))}
          </div>
        </label>

        <div className="row">
          <label>시작 시각<input type="time" value={form.startTime} onChange={set('startTime')} /></label>
          <label>종료 시각<input type="time" value={form.endTime} onChange={set('endTime')} /></label>
        </div>

        <div className="row">
          <label>시작일<input type="date" value={form.startDate} onChange={set('startDate')} /></label>
          <label>종료일<input type="date" value={form.endDate} onChange={set('endDate')} /></label>
        </div>

        <label>정원<input type="number" min="1" value={form.capacity} onChange={set('capacity')} /></label>

        <button className="submit" disabled={busy || days.length === 0}>
          {busy ? '처리 중…' : '개설하기'}
        </button>
      </form>

      {result && (
        <div className={result.kind === 'ok' ? 'alert ok' : 'alert error'}>
          <strong>{result.kind === 'ok' ? '성공' : '충돌'}</strong>
          <p>{result.message}</p>
          {result.details?.length > 0 && (
            <ul>
              {result.details.slice(0, 3).map((d, i) => (
                <li key={i}>
                  {d.conflictType === 'teacher' ? '강사' : '강의실'} 겹침 — {d.courseTitle}
                  {' '}({new Date(d.startAt).toISOString().slice(0, 16).replace('T', ' ')})
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
