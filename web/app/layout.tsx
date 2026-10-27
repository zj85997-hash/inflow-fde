import type { Metadata } from 'next';
import './globals.css';
import Sidebar from '@/components/Sidebar';

export const metadata: Metadata = {
  title: 'InFlow FDE · 企业 AI 转型操盘台',
  description: '主 Agent 管部门，部门 Agent 管数字员工；数字由代码算，动钱的动作人拍板，每一分 AI 成本都记账。',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <div className="flex h-screen overflow-hidden">
          <Sidebar />
          <main className="flex-1 overflow-y-auto pt-12 md:pt-0">{children}</main>
        </div>
      </body>
    </html>
  );
}
