import axios from "axios";
import fs from "fs";
import FormData from "form-data";
import { WHISPER_URL } from "./config";

export const transcribe = async (file: string): Promise<string> => {
    const form = new FormData();
    form.append("file", fs.createReadStream(file));

    const res = await axios.post(WHISPER_URL, form, {
        headers: form.getHeaders(),
        timeout: 120000,
    });

    return res.data.text;
};
