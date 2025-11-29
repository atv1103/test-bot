export type Task = () => Promise<void>;

const queue: Task[] = [];
let isProcessing = false;

export const addTask = (task: Task) => {
    queue.push(task);
    processQueue();
};

const processQueue = async () => {
    if (isProcessing) return;
    isProcessing = true;

    while (queue.length > 0) {
        const job = queue.shift();
        if (!job) continue;

        try {
            await job();
        } catch (e) {
            console.error("Queue job error:", e);
        }
    }

    isProcessing = false;
};
