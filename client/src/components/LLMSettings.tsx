import { useState } from 'react';
import { Socket } from 'socket.io-client';
import { ClientToServerEvents, ServerToClientEvents } from '../../../shared/types';

interface Props {
  socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  onClose: () => void;
}

const PRESETS: { label: string; endpoint: string; model: string }[] = [
  { label: 'DeepSeek', endpoint: 'https://api.deepseek.com', model: 'deepseek-chat' },
  { label: '豆包 (Doubao)', endpoint: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-pro-32k' },
  { label: 'GLM (智谱)', endpoint: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { label: 'Kimi (月之暗面)', endpoint: 'https://api.moonshot.cn', model: 'moonshot-v1-8k' },
  { label: '自定义', endpoint: '', model: '' },
];

export default function LLMSettings({ socket, onClose }: Props) {
  const [preset, setPreset] = useState(0);
  const [endpoint, setEndpoint] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const handlePresetChange = (idx: number) => {
    setPreset(idx);
    setEndpoint(PRESETS[idx].endpoint);
    setModel(PRESETS[idx].model);
    setMessage('');
  };

  const handleSave = () => {
    if (!endpoint || !apiKey || !model) {
      setMessage('请填写完整信息');
      return;
    }
    setSaving(true);
    socket.emit('set_llm_config', { endpoint, apiKey, model }, (res: any) => {
      setSaving(false);
      if (res?.success) {
        setMessage('保存成功！');
        setTimeout(onClose, 800);
      } else {
        setMessage(res?.error || '保存失败');
      }
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <h3>🤖 LLM 人机设置</h3>
        <p className="modal-hint">填入大模型 API，即可添加 AI 人机对战</p>

        <div className="form-group">
          <label>服务商</label>
          <select value={preset} onChange={e => handlePresetChange(Number(e.target.value))}>
            {PRESETS.map((p, i) => (
              <option key={i} value={i}>{p.label}</option>
            ))}
          </select>
        </div>

        {preset === 4 && (
          <>
            <div className="form-group">
              <label>API 地址</label>
              <input
                type="text"
                value={endpoint}
                onChange={e => setEndpoint(e.target.value)}
                placeholder="https://api.example.com"
              />
            </div>
            <div className="form-group">
              <label>模型名</label>
              <input
                type="text"
                value={model}
                onChange={e => setModel(e.target.value)}
                placeholder="model-name"
              />
            </div>
          </>
        )}

        <div className="form-group">
          <label>API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="sk-..."
          />
        </div>

        {message && <p className={`form-msg ${message.includes('成功') ? 'success' : 'error'}`}>{message}</p>}

        <div className="modal-actions">
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  );
}
