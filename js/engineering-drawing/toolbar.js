document.querySelectorAll(".drawing-category").forEach(categoryButton => {
	categoryButton.addEventListener("click", () => {
		document.querySelectorAll(".drawing-category").forEach(button => button.classList.remove("active"));
		categoryButton.classList.add("active");
		renderEngineeringTools(categoryButton.dataset.category);
	});
});
