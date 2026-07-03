export function cn(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(" ");
}

export function handleFileAction(url: string | null | undefined, action: 'view' | 'download', filename: string = 'documento.pdf') {
  if (!url) return;
  
  if (url.startsWith('data:')) {
    try {
      const parts = url.split(',');
      const mimeMatch = parts[0].match(/:(.*?);/);
      const mimeType = mimeMatch ? mimeMatch[1] : 'application/pdf';
      const bstr = atob(parts[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      const blob = new Blob([u8arr], { type: mimeType });
      const blobUrl = URL.createObjectURL(blob);
      
      if (action === 'view') {
        const newWindow = window.open(blobUrl, '_blank');
        if (newWindow) {
           // Release object url after a delay to ensure it loads
           setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
        } else {
           // Fallback if popup blocked
           window.location.href = blobUrl;
        }
      } else {
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 100);
      }
    } catch (e) {
      console.error("Error processing data URI", e);
      // Fallback
      if (action === 'view') {
        window.open(url, '_blank');
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    }
  } else {
    if (action === 'view') {
      window.open(url, '_blank');
    } else {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  }
}

