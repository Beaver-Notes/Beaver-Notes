// modules/handlers/pdf-handler.js
import { ipcMain } from 'electron-better-ipc';
import { BrowserWindow, dialog, app } from 'electron';
import { writeFileSync } from 'fs-extra';
import path from 'path';

export class PDFHandler {
  register() {
    ipcMain.answerRenderer('print-pdf', this.handlePrintPDF.bind(this));
  }

  async handlePrintPDF(options) {
    const { pdfName } = options;
    const focusedWindow = BrowserWindow.getFocusedWindow();

    if (!focusedWindow) return;

    const { filePath } = await dialog.showSaveDialog(focusedWindow, {
      title: 'Save PDF',
      defaultPath: path.join(
        app.getPath('desktop'),
        pdfName || 'editor-output.pdf'
      ),
      filters: [
        { name: 'PDF Files', extensions: ['pdf'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (!filePath) return;

    try {
      await this.injectPrintStyles(focusedWindow);
      const pdfData = await this.generatePDF(focusedWindow);
      writeFileSync(filePath, pdfData);
    } catch (error) {
      console.error('Error generating PDF:', error);
    }
  }

  async injectPrintStyles(window) {
    await window.webContents.executeJavaScript(`
      // Check if style already exists and remove it
      (() => {
        // Create a new style element
        const style = document.createElement('style');
        style.id = 'print-style'; // Unique ID to prevent conflicts
        style.innerHTML = \`
          @page {
            margin: 0;
          }
          html, body {
            width: 100%;
            height: 100%;
            margin: 0;
            padding: 0;
          }
          * {
            box-sizing: border-box;
          }
        \`;
        document.head.appendChild(style);
    
        // Apply background color directly
        document.body.style.margin = '0';
        document.body.style.padding = '0';
        document.documentElement.style.margin = '0';
        document.documentElement.style.padding = '0';
      })();
    `);
  }

  async generatePDF(window) {
    return await window.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      marginsType: 0,
    });
  }
}
