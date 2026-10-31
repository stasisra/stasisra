"use client";

import { useState } from "react";
import {
  AttachmentButton,
  TaskAttachmentsModal,
} from "@/components/TaskAttachments";

export function TaskAttachmentsInline({
  taskId,
  taskTitle,
}: {
  taskId: string;
  taskTitle: string;
}) {
  const [open, setOpen] = useState(false);

  // ✅ заставляем AttachmentButton перечитать count после add/delete
  const [btnKey, setBtnKey] = useState(0);

  return (
    <>
      <AttachmentButton
        key={`${taskId}:${btnKey}`}
        taskId={taskId}
        onOpen={() => setOpen(true)}
      />

      <TaskAttachmentsModal
        taskId={taskId}
        taskTitle={taskTitle}
        open={open}
        onClose={() => setOpen(false)}
        onChanged={() => {
          // после добавления/удаления обновляем бейдж на кнопке
          setBtnKey((k) => k + 1);
        }}
      />
    </>
  );
}
