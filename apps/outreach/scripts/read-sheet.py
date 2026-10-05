import json,sys,zipfile,xml.etree.ElementTree as E
ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(sys.argv[1]) as z:
    shared=[]
    if 'xl/sharedStrings.xml' in z.namelist():
        shared=[''.join(n.itertext()) for n in E.fromstring(z.read('xl/sharedStrings.xml')).findall('s:si',ns)]
    rows=[]
    for row in E.fromstring(z.read('xl/worksheets/sheet1.xml')).findall('.//s:row',ns):
        cells={}
        for cell in row.findall('s:c',ns):
            val=cell.find('s:v',ns)
            text=val.text if val is not None else ''
            if cell.get('t')=='s':text=shared[int(text)]
            if cell.get('t')=='inlineStr':text=''.join(cell.find('s:is',ns).itertext())
            if text:cells[cell.get('r')]=text
        if cells:rows.append({'row':int(row.get('r')), 'cells':cells})
    headers=['Company','POC','Partner Program Status','Story','NCP(Yes/No)','Sales Status','Location','Contacted by']
    if not rows or any(rows[0]['cells'].get(chr(65+i)+'1')!=v for i,v in enumerate(headers)):raise ValueError('Sheet headers changed; manual mapping required')
    print(json.dumps([r for r in rows[1:] if r['cells'].get('A'+str(r['row']))],ensure_ascii=False))
