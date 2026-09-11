import { Link } from "react-router-dom";

/**
 * 아직 구현하지 않은 화면 자리.
 * HANDOVER.md 의 "남은 작업" 항목과 짝이 맞는다.
 */
export default function Placeholder({ title, note }: { title: string; note: string }) {
  return (
    <div className="center-screen">
      <div className="panel stack" style={{ maxWidth: 560 }}>
        <h1>{title}</h1>
        <p className="muted">{note}</p>
        <Link className="btn btn-sm" to="/">
          처음으로
        </Link>
      </div>
    </div>
  );
}
