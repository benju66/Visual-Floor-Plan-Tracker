import fitz

doc = fitz.open()
page = doc.new_page()

fitz_points = [fitz.Point(100, 100), fitz.Point(200, 100), fitz.Point(150, 200)]
color_rgb = (1, 0, 0)

try:
    annot = page.add_polygon_annot(fitz_points)
    annot.set_colors(stroke=color_rgb, fill=color_rgb)
    annot.set_opacity(0.4)
    info = annot.info
    info["title"] = "SitePulse"
    annot.set_info(info)
    annot.update()
    print("Annotation success!")
except Exception as e:
    print("Annotation Error:", e)

doc.save("out.pdf")
print("Saved out.pdf")

