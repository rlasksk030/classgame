import TeacherActivities from "../features/activities/TeacherActivities";
import { getSupabase } from "../lib/supabase";
import { Link } from "react-router-dom";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { classifyTeacherError } from "../lib/teacherErrors";

import {
  teacherCreateStudent,
  teacherUpsertClass,
  teacherUpdateStudent,
  teacherListClasses,
  teacherListLessonSettings,
  teacherListStudents,
  teacherResetStudentPin,
  teacherSetLessonLock,
  teacherToggleStudent,
  type ClassData,
  type LessonSettingRow,
  type TeacherStudentRow,
} from "../lib/studentApi";

/**
 * 교사용 관리자 최소 화면(핵심 기능): 반 조회 + 반별 학생/차시 잠금 관리.
 * 나머지 고급 편집은 다음 단계로 이어질 수 있습니다.
 */
export default function TeacherPage() {
  const [classes, setClasses] = useState<ClassData[]>([]);
  const [classId, setClassId] = useState("");
  const [students, setStudents] = useState<TeacherStudentRow[]>([]);
  const [lessons, setLessons] = useState<LessonSettingRow[]>([]);
  const [name, setName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedClass = useMemo(() => classes.find((row) => row.id === classId) ?? null, [classes, classId]);

  const load = async () => {
    try {
      setError(null);
      const payload = await teacherListClasses();
      setClasses(payload.classes);
      if (!classId && payload.classes.length > 0) {
        setClassId(payload.classes[0].id);
      }
    } catch (err) {
      const info = classifyTeacherError(err);
      setError(`${info.code}: ${info.message}`);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!classId) return;

    let cancelled = false;

    const loadClassData = async () => {
      try {
        setBusy(true);
        const studentsPayload = await teacherListStudents(classId);
        const lessonPayload = await teacherListLessonSettings(classId);
        if (cancelled) return;
        setStudents(studentsPayload.students);
        setLessons(lessonPayload.lessons);
      } catch (err) {
        if (!cancelled) { const info = classifyTeacherError(err); setError(`${info.code}: ${info.message}`); }
      } finally {
        if (!cancelled) setBusy(false);
      }
    };

    loadClassData();

    return () => {
      cancelled = true;
    };
  }, [classId]);

  const createStudent = async (event: FormEvent) => {
    event.preventDefault();
    if (!classId || !name.trim()) return;
    try {
      setBusy(true);
      const data = await teacherCreateStudent(classId, name.trim());
      setMessage(`"${data.student.name}" 학생 PIN: ${data.pinPlain}`);
      setName("");
      const studentsPayload = await teacherListStudents(classId);
      setStudents(studentsPayload.students);
    } catch (err) {
      setError(err instanceof Error ? err.message : "학생을 추가하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const resetPin = async (studentId: string) => {
    try {
      const result = await teacherResetStudentPin(classId, studentId);
      setMessage(`새 PIN: ${result.pinPlain}`);
      const studentsPayload = await teacherListStudents(classId);
      setStudents(studentsPayload.students);
    } catch (err) {
      setError(err instanceof Error ? err.message : "PIN 재발급 실패");
    }
  };

  const toggleStudent = async (student: TeacherStudentRow) => {
    const shouldDisable = student.status === "active";
    try {
      await teacherToggleStudent(classId, student.id, shouldDisable);
      const studentsPayload = await teacherListStudents(classId);
      setStudents(studentsPayload.students);
    } catch (err) {
      setError(err instanceof Error ? err.message : "상태 변경 실패");
    }
  };

  const toggleLessonLock = async (lesson: number, locked: boolean) => {
    try {
      await teacherSetLessonLock(classId, lesson, locked);
      const lessonPayload = await teacherListLessonSettings(classId);
      setLessons(lessonPayload.lessons);
    } catch (err) {
      setError(err instanceof Error ? err.message : "잠금 변경 실패");
    }
  };
  const setPracticeCount = async (lesson:number, count:5|10|15|20) => {
    try { const row=lessons.find(item=>item.lesson===lesson); await teacherSetLessonLock(classId,lesson,row?.locked??(lesson!==1),count); setLessons((await teacherListLessonSettings(classId)).lessons); }
    catch (err) { setError(err instanceof Error ? err.message : "추가 문제 수를 저장하지 못했습니다."); }
  };

  const copyText = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setMessage("클립보드에 복사했습니다.");
    } catch {
      setMessage("클립보드 복사에 실패했습니다.");
    }
  };

  return (
    <div className="screen app-max">
      <div className="stack" style={{ gap: 16 }}>
        <h1>🧱 교사 페이지</h1>
        <div className="toolbar-row"><Link className="btn" to="/teacher/problems/new">3D 문제 만들기</Link><Link className="btn" to="/teacher/worksheet-import">학습지로 문제 만들기</Link></div>

        <section className="panel stack">
          <h3>반 선택</h3>
          <button className="btn" onClick={async()=>{const name=window.prompt("새 학급 이름");if(!name?.trim())return;try{await teacherUpsertClass({name:name.trim()});await load();}catch{setError("학급을 만들지 못했습니다.");}}}>새 학급 만들기</button>
          <div className="toolbar-row" style={{ alignItems: "center" }}>
            <select
              className="field"
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
              aria-label="반 선택"
            >
              {classes.length === 0 ? (
                <option value="">반 없음</option>
              ) : (
                classes.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name} ({row.class_code})
                  </option>
                ))
              )}
            </select>
            <button className="btn btn-sm" type="button" onClick={load}>
              새로고침
            </button>
          </div>
          {selectedClass ? <p className="muted">선택 반: {selectedClass.name}</p> : <p className="muted">반을 선택해 주세요.</p>}
        </section>

        <section className="panel stack">
          <h3>학생 PIN 관리</h3>
          <button className="btn" disabled={!students.length} onClick={()=>void copyText(students.map(s=>`${s.name}\t${s.pinPlain}`).join("\n"))}>전체 PIN 복사</button>
          <form className="toolbar-row" onSubmit={createStudent}>
            <input
              className="field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="새 학생 이름"
              required
            />
            <button className="btn" type="submit" disabled={busy || !classId || !name.trim()}>
              학생 추가
            </button>
          </form>

          <div className="teacher-table-wrap">
            <table className="teacher-table">
              <thead>
                <tr>
                  <th>이름</th>
                  <th>PIN</th>
                  <th>상태</th>
                  <th>작업</th>
                </tr>
              </thead>
              <tbody>
                {students.map((student) => (
                  <tr key={student.id}>
                    <td><Link to={`/teacher/students/${student.id}`}>{student.name} · 기록 보기</Link></td>
                    <td>
                      <button className="btn btn-sm" type="button" onClick={() => copyText(student.pinPlain)}>
                        {student.pinPlain || "(준비중)"}
                      </button>
                    </td>
                    <td>{student.status}</td>
                    <td className="toolbar-row">
                      <button className="btn btn-sm" onClick={async()=>{const name=window.prompt("학생 이름",student.name);if(!name?.trim())return;try{await teacherUpdateStudent(classId,student.id,{name:name.trim()});setStudents((await teacherListStudents(classId)).students);}catch{setError("이름을 수정하지 못했습니다.");}}}>이름 수정</button>
                      <button className="btn btn-sm" onClick={async()=>{if(!window.confirm(`${student.name} 학생과 학습 기록을 삭제할까요?`))return;const {error}=await getSupabase().from("sb_students").delete().eq("id",student.id).eq("class_id",classId);if(error){setError("삭제하지 못했습니다.");return;}setStudents(students.filter(s=>s.id!==student.id));}}>삭제</button>
                      <button className="btn btn-sm" type="button" onClick={() => resetPin(student.id)}>
                        PIN 재발급
                      </button>
                <button
                        className="btn btn-sm"
                        type="button"
                        onClick={() => toggleStudent(student)}
                        disabled={busy}
                      >
                        {student.status === "active" ? "비활성" : "활성"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel stack">
          <h3>차시 잠금</h3><div className="toolbar-row">{[true,false].map(locked=><button className="btn" key={String(locked)} disabled={!classId||busy} onClick={async()=>{setBusy(true);try{for(let lesson=1;lesson<=12;lesson++)await teacherSetLessonLock(classId,lesson,locked);setLessons((await teacherListLessonSettings(classId)).lessons);}catch{setError("일부 차시 설정에 실패했습니다. 새로고침해 확인해 주세요.");}finally{setBusy(false);}}}>{locked?"전체 잠금":"전체 해제"}</button>)}</div>
          <div className="toolbar-row" style={{ flexWrap: "wrap" }}>
            {lessons.map((row) => (
              <span key={`${row.lesson}`} className="toolbar-row">
              <button
                className={`btn btn-sm ${row.locked ? "btn-danger" : "btn-primary"}`}
                onClick={() => toggleLessonLock(row.lesson, !row.locked)}
              >
                {row.lesson}차시 {row.locked ? "잠금" : "해제"}
                </button>
                <label className="muted">추가 문제 <select className="field" aria-label={`${row.lesson}차시 추가 문제 수`} value={row.practice_count??''} onChange={e=>{const value=Number(e.target.value);if([5,10,15,20].includes(value))void setPracticeCount(row.lesson,value as 5|10|15|20);}}><option value="">권장</option>{[5,10,15,20].map(n=><option key={n} value={n}>{n}문제</option>)}</select></label>
              </span>
            ))}
          </div>
        </section>

        <TeacherActivities classId={classId} students={students}/>
        {error ? <p className="error">{error}</p> : null}
        {message ? <p className="muted">{message}</p> : null}
      </div>
    </div>
  );
}
