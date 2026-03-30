"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function JoinRoom() {
  const [roomId, setRoomId] = useState("");
  const router = useRouter();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!roomId) return;

    router.push(`/room/${roomId}`);
  };
  const handleCreateRoom = () => {
    const roomId = crypto.randomUUID();
    router.push(`/room/${roomId}`);
  };

  return (
    <div className='min-h-[calc(100vh-3.5rem)] flex items-center justify-center bg-white px-4'>
      <div className='-translate-y-7 bg-white border border-gray-300 rounded-xl shadow-xl p-8 max-w-md w-full'>
        <h1 className='text-3xl font-bold text-black mb-2 text-center tracking-wide'>
          XDrop
        </h1>
        <p className='text-center text-gray-600 mb-8'>
          ファイル転送アプリケーション
        </p>

        <form onSubmit={handleSubmit} className='space-y-4'>
          <div>
            <label className='block text-sm font-semibold text-black mb-2'>
              ルームID
            </label>
            <input
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              placeholder='ルームIDを入力...'
              className='w-full px-4 py-2 border border-gray-300 bg-white text-black rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-gray-500'
            />
          </div>

          <button
            type='submit'
            className='w-full px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white font-bold rounded-lg transition-colors shadow-md hover:shadow-lg'
          >
            ルームに参加
          </button>
        </form>

        <div className='mt-6 pt-6 border-t border-gray-200'>
          <p className='text-center text-gray-600 text-sm mb-3'>
            新しいルームを作成しますか？
          </p>
          <button
            onClick={handleCreateRoom}
            className='block w-full px-4 py-2 bg-gray-800 hover:bg-black text-white font-bold rounded-lg transition-colors text-center shadow-md hover:shadow-lg border border-gray-700'
          >
            新しいルームを作成
          </button>
        </div>
      </div>
    </div>
  );
}
