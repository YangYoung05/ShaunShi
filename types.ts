import { Type, FunctionDeclaration } from '@google/genai';

// App specific types
export interface LogEntry {
  id: string;
  timestamp: string;
  source: 'SYSTEM' | 'JARVIS' | 'USER' | 'TOOL';
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

export interface MemoryItem {
  key: string;
  value: string;
  addedAt: number;
}

export interface AROverlayData {
  id: string;
  label: string;
  box: [number, number, number, number]; // [ymin, xmin, ymax, xmax] 0-100 range
  color: string;
  timestamp: number;
}

// Tool Definitions for Function Calling (Translated to Chinese)
export const TOOLS_DECLARATION: FunctionDeclaration[] = [
  {
    name: 'setReminder',
    parameters: {
      type: Type.OBJECT,
      description: '为用户设置提醒或闹钟。',
      properties: {
        task: {
          type: Type.STRING,
          description: '提醒的具体内容。',
        },
        time: {
          type: Type.STRING,
          description: '提醒的时间（例如“下午5点”、“10分钟后”）。',
        },
      },
      required: ['task', 'time'],
    },
  },
  {
    name: 'toggleSmartHome',
    parameters: {
      type: Type.OBJECT,
      description: '控制智能家居设备，如灯光、门锁或恒温器。',
      properties: {
        device: {
          type: Type.STRING,
          description: '设备名称（例如“客厅灯”、“前门”）。',
        },
        action: {
          type: Type.STRING,
          description: '执行的动作（例如“打开”、“关闭”、“锁定”、“解锁”）。',
        },
      },
      required: ['device', 'action'],
    },
  },
  {
    name: 'saveToLongTermMemory',
    parameters: {
      type: Type.OBJECT,
      description: '将特定的事实或偏好保存到长期记忆中，以便将来调用。',
      properties: {
        key: {
          type: Type.STRING,
          description: '记忆的简短关键词或类别（例如“生日”、“偏好”）。',
        },
        value: {
          type: Type.STRING,
          description: '需要记住的具体细节。',
        },
      },
      required: ['key', 'value'],
    },
  }
];