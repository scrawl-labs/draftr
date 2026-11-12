package main

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"example.com/shop/internal/store"
)

func main() {
	r := gin.Default()
	r.GET("/products", list)
	r.POST("/products", create)
	http.HandleFunc("GET /healthz", health)
	_ = store.New()
}
