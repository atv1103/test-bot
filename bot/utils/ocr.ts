import { createWorker } from "tesseract.js";
import fs from "fs";

export const ocrImage = async (imagePath: string): Promise<string> => {
    const worker = await createWorker();
    await worker.loadLanguage("eng");
    await worker.initialize("eng");

    const { data } = await worker.recognize(imagePath);
    await worker.terminate();

    return data.text;
};
