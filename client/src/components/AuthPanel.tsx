import { useState } from 'react';
import { saveAuth } from '../auth';

interface Props {
  onAuthSuccess: (accountId: string, username: string) => void;
  onGuest: () => void;
}

type Tab = 'login' | 'register';

const BASE_URL = window.location.origin;

export default function AuthPanel({ onAuthSuccess, onGuest }: Props) {
  const [tab, setTab] = useState<Tab>('login');
  const [identifier, setIdentifier] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const clearError = () => { if (error) setError(''); };

  const handleLogin = async () => {
    if (!identifier.trim() || !password) {
      setError('请填写账号/用户名和密码');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: identifier.trim(), password }),
      });
      const data = await res.json();
      if (data.success) {
        saveAuth(data.token!, data.accountId!, data.username!);
        onAuthSuccess(data.accountId!, data.username!);
      } else {
        setError(data.error || '登录失败');
      }
    } catch {
      setError('无法连接服务器');
    }
    setLoading(false);
  };

  const handleRegister = async () => {
    const uname = username.trim();
    if (!uname || !password) {
      setError('请填写用户名和密码');
      return;
    }
    if (password !== confirmPw) {
      setError('两次密码不一致');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${BASE_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: uname, password }),
      });
      const data = await res.json();
      if (data.success) {
        saveAuth(data.token!, data.accountId!, data.username!);
        onAuthSuccess(data.accountId!, data.username!);
      } else {
        setError(data.error || '注册失败');
      }
    } catch {
      setError('无法连接服务器');
    }
    setLoading(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent, action: () => void) => {
    if (e.key === 'Enter') action();
  };

  return (
    <div className="auth-panel">
      <h1 className="game-title">⚔ 蓄气对决 ⚔</h1>

      <div className="auth-tabs">
        <button
          className={`tab-btn ${tab === 'login' ? 'active' : ''}`}
          onClick={() => { setTab('login'); clearError(); }}
        >
          登录
        </button>
        <button
          className={`tab-btn ${tab === 'register' ? 'active' : ''}`}
          onClick={() => { setTab('register'); clearError(); }}
        >
          注册
        </button>
      </div>

      {tab === 'login' ? (
        <div className="auth-form" onKeyDown={(e) => handleKeyDown(e, handleLogin)}>
          <input
            className="input"
            type="text"
            placeholder="账号ID 或 用户名"
            value={identifier}
            onChange={(e) => { setIdentifier(e.target.value); clearError(); }}
            maxLength={20}
            autoFocus
          />
          <input
            className="input"
            type="password"
            placeholder="密码"
            value={password}
            onChange={(e) => { setPassword(e.target.value); clearError(); }}
            maxLength={50}
          />
          {error && <div className="auth-error">{error}</div>}
          <button className="btn btn-primary" onClick={handleLogin} disabled={loading}>
            {loading ? '登录中…' : '登录'}
          </button>
        </div>
      ) : (
        <div className="auth-form" onKeyDown={(e) => handleKeyDown(e, handleRegister)}>
          <input
            className="input"
            type="text"
            placeholder="用户名（3-12字符）"
            value={username}
            onChange={(e) => { setUsername(e.target.value); clearError(); }}
            maxLength={12}
            autoFocus
          />
          <input
            className="input"
            type="password"
            placeholder="密码（至少4字符）"
            value={password}
            onChange={(e) => { setPassword(e.target.value); clearError(); }}
            maxLength={50}
          />
          <input
            className="input"
            type="password"
            placeholder="确认密码"
            value={confirmPw}
            onChange={(e) => { setConfirmPw(e.target.value); clearError(); }}
            maxLength={50}
          />
          {error && <div className="auth-error">{error}</div>}
          <button className="btn btn-primary" onClick={handleRegister} disabled={loading}>
            {loading ? '注册中…' : '注册'}
          </button>
        </div>
      )}

      <div className="auth-divider">
        <span>或</span>
      </div>

      <button className="btn btn-secondary" onClick={onGuest}>
        游客游玩
      </button>
    </div>
  );
}
