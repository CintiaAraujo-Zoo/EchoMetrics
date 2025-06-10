import os
import cv2
import numpy as np
import openpyxl # Importamos a nova biblioteca
from flask import Flask, render_template, request, jsonify, url_for, send_from_directory
from werkzeug.utils import secure_filename

# --- Configuração ---
UPLOAD_FOLDER = 'uploads'
RESULTS_FOLDER = 'results' # Nova pasta para os arquivos Excel
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'bmp'}

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

# Garante que as pastas de uploads e resultados existam
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(RESULTS_FOLDER, exist_ok=True)

# --- Funções Auxiliares ---
def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

# --- Rotas Principais da Aplicação ---
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

@app.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files: return jsonify({'error': 'Nenhum arquivo enviado'}), 400
    file = request.files['file']
    if file.filename == '': return jsonify({'error': 'Nenhum arquivo selecionado'}), 400
    if file and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(filepath)
        return jsonify({'filename': filename, 'url': url_for('uploaded_file', filename=filename)})
    return jsonify({'error': 'Tipo de arquivo não permitido'}), 400

@app.route('/calculate', methods=['POST'])
def calculate():
    # Esta rota permanece a mesma, apenas calcula e retorna os valores.
    data = request.get_json()
    try:
        p1_scale = data['scalePoints'][0]
        p2_scale = data['scalePoints'][1]
        dist_pixels = np.sqrt((p1_scale['x'] - p2_scale['x'])**2 + (p1_scale['y'] - p2_scale['y'])**2)
        if dist_pixels == 0: return jsonify({'error': 'Pontos de calibração idênticos'}), 400
        pixels_per_cm = dist_pixels / 1.0

        aol_contour = np.array([[p['x'], p['y']] for p in data['aolPoints']], dtype=np.int32)
        area_pixels = cv2.contourArea(aol_contour)
        aol_cm2 = area_pixels / (pixels_per_cm ** 2)

        p1_fat = data['fatPoints'][0]
        p2_fat = data['fatPoints'][1]
        fat_dist_pixels = np.sqrt((p1_fat['x'] - p2_fat['x'])**2 + (p1_fat['y'] - p2_fat['y'])**2)
        fat_cm = fat_dist_pixels / pixels_per_cm
        
        return jsonify({
            'aol_cm2': round(aol_cm2, 2),
            'fat_thickness_cm': round(fat_cm, 2),
            'pixels_per_cm': round(pixels_per_cm, 2)
        })
    except Exception as e:
        return jsonify({'error': f'Erro no cálculo: {str(e)}'}), 500

# --- NOVA ROTA PARA SALVAR EM EXCEL ---
@app.route('/save_to_excel', methods=['POST'])
def save_to_excel():
    data = request.get_json()
    if not all(k in data for k in ['imageCode', 'aol', 'egs', 'batchCode']):
        return jsonify({'error': 'Dados incompletos para salvar no Excel'}), 400
    
    try:
        # Define o nome do arquivo Excel baseado no código do lote
        excel_filename = f"{data['batchCode']}_resultados.xlsx"
        excel_filepath = os.path.join(RESULTS_FOLDER, excel_filename)

        # Verifica se o arquivo já existe para não reescrever o cabeçalho
        if not os.path.exists(excel_filepath):
            workbook = openpyxl.Workbook()
            sheet = workbook.active
            sheet.title = "Resultados"
            # Cria o cabeçalho
            sheet.append(['Imagem', 'AOL (cm²)', 'EGS (cm)'])
        else:
            workbook = openpyxl.load_workbook(excel_filepath)
            sheet = workbook.active

        # Adiciona a nova linha de dados
        sheet.append([data['imageCode'], data['aol'], data['egs']])
        
        # Salva o arquivo
        workbook.save(excel_filepath)
        
        return jsonify({'success': True, 'message': f'Salvo em {excel_filename}'})

    except Exception as e:
        return jsonify({'error': f'Erro ao salvar no Excel: {str(e)}'}), 500


if __name__ == '__main__':
    app.run(debug=True)